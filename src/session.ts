import type {
  BrainContext,
  Decision,
  ExitReason,
  Persona,
  StepEvent,
} from "./types.js";
import type { BrowserDriver } from "./browser/driver.js";
import type { Brain } from "./types.js";
import { appendFileSync } from "node:fs";
import { buildVerificationPrompt } from "./brain/prompt.js";
import { blockedAction } from "./safety.js";
import { parseVerdict } from "./brain/adapters/cli-brain.js";
import type { MailProvider, Mailbox, MailMessage } from "./mail/types.js";
import { extractCodes, stripInvisible } from "./mail/types.js";

export interface SessionOptions {
  url: string;
  persona: Persona;
  brain: Brain & { ask?(prompt: string): Promise<string> };
  driver: BrowserDriver;
  sessionDir: string;
  mail?: { provider: MailProvider; box: Mailbox };
}

export interface SessionResult {
  events: StepEvent[];
  exit: ExitReason;
}

const MAX_CONSECUTIVE_FAILURES = 4;
/** Completion claims re-checked per session. Each is one un-retried call. */
export const MAX_VERIFICATIONS = 2;

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const { driver, persona, brain } = opts;
  const jsonlPath = `${opts.sessionDir}/session.jsonl`;
  const events: StepEvent[] = [];

  console.log(`\n  ${persona.name} (${persona.temperature}) is visiting ${opts.url}`);
  console.log(`  brain: ${brain.name} | patience: ${persona.patience_steps} steps\n`);

  await driver.goto(opts.url);

  let exit: ExitReason | null = null;
  let consecutiveFailures = 0;
  let failedHint: string | undefined;
  let verificationsUsed = 0;
  let emailResult: string | undefined;
  /** The last mail that actually landed — it stays in the inbox after later checks */
  let arrivedMail: string | undefined;
  let emailWaitSeconds = 0;
  if (opts.mail) {
    console.log(`  mailbox: ${opts.mail.box.address}`);
  }

  for (let step = 1; step <= persona.patience_steps; step++) {
    let snap;
    try {
      snap = await driver.snapshot();
    } catch (e) {
      exit = {
        kind: "guardrail",
        detail: `Page became unreadable at step ${step}: ${(e as Error).message}`,
      };
      break;
    }

    const screenshotPath = await driver.screenshotPath(step);

    const ctx: BrainContext = {
      persona,
      ariaYaml: snap.ariaYaml,
      screenshotPath,
      url: snap.url,
      stepNumber: step,
      history: events,
      failedHint,
      emailAddress: opts.mail?.box.address,
      emailResult,
      readsFiles: opts.brain.readsFiles ?? false,
    };

    // THINK
    process.stdout.write(`  [${step}/${persona.patience_steps}] thinking...`);
    let decision: Decision;
    try {
      decision = await brain.decide(ctx);
    } catch (e) {
      console.log(` failed`);
      exit = {
        kind: "guardrail",
        detail: `Brain "${brain.name}" failed at step ${step}: ${(e as Error).message}`,
      };
      break;
    }
    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    } else {
      process.stdout.write("\n");
    }
    console.log(
      `  [${decision.confusion}/10 confusion] ${persona.name}: "${trim(decision.thought, 100)}"`,
    );

    const event: StepEvent = {
      n: step,
      url: snap.url,
      timestamp: new Date().toISOString(),
      screenshot: screenshotPath || undefined,
      decision,
    };

    // EXIT DECISIONS — complete requires verification first
    if (decision.action.type === "complete") {
      if (verificationsUsed < MAX_VERIFICATIONS && brain.ask) {
        verificationsUsed++;
        const verdict = await verifyGoal(brain, persona.goal, snap.ariaYaml);
        if (!verdict || !verdict.achieved) {
          const note =
            verdict?.note ??
            "verification was inconclusive — do not trust it as done";
          console.log(`  ✗ goal NOT verified complete: ${trim(note, 120)}`);
          event.note = `claimed complete but verification said: ${note}`;
          events.push(event);
          appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
          continue; // keep going — the persona was wrong about being done
        }
        console.log(`  ✓ goal verified complete`);
      }
      events.push(event);
      appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
      exit = { kind: "completed", summary: decision.action.summary };
      break;
    }

    if (decision.action.type === "abandon") {
      events.push(event);
      appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
      exit = {
        kind: "abandoned",
        reason: decision.action.reason,
        question: decision.action.question,
      };
      break;
    }

    // GUARDRAIL: repeating action pattern
    const loop = stuckPattern([...events, event]);
    if (loop) {
      events.push(event);
      appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
      exit = {
        kind: "guardrail",
        detail: `Stuck loop detected at step ${step}: ${loop} on ${snap.url}`,
      };
      break;
    }

    // Fix 3: the JSONL line is written at the END of the step, so overrides and
    // action failures recorded below actually reach the file the experts read.
    events.push(event);
    const commit = () => appendFileSync(jsonlPath, JSON.stringify(event) + "\n");

    // ACT — check_email is handled by the mail layer, not the browser
    if (decision.action.type === "check_email") {
      const waitSeconds = decision.action.seconds;
      const check = await checkInbox(opts, waitSeconds, () => {
        emailWaitSeconds += waitSeconds;
        return emailWaitSeconds > (persona.otp_patience_seconds ?? 180);
      });
      if (check.mail) arrivedMail = check.mail;
      emailResult = mergeInbox(check, arrivedMail);
      consecutiveFailures = 0;
      commit();
      continue; // no page change; next think sees the inbox result
    }

    // TRUST BOUNDARY: the brain must never invent an email address.
    // Any email it types is forced to the assigned ephemeral mailbox.
    if (
      decision.action.type === "type" &&
      opts.mail &&
      /@/.test(decision.action.text) &&
      decision.action.text.trim() !== opts.mail.box.address
    ) {
      event.note = `brain tried to use invented email "${trim(decision.action.text, 60)}" — overridden with the assigned mailbox`;
      console.log(
        `  ⚠ email override: invented address replaced with ${opts.mail.box.address}`,
      );
      decision = {
        ...decision,
        action: { ...decision.action, text: opts.mail.box.address },
      };
    }

    // SAFETY BOUNDARY: looking at a checkout page is fine, acting on it is not.
    const refusal = blockedAction(decision.action, snap.ariaYaml);
    if (refusal) {
      event.note = [event.note, `blocked: ${refusal}`].filter(Boolean).join(" | ");
      failedHint = `The system ${refusal}. Find another way or walk out — do not retry it.`;
      console.log(`  🛑 blocked: ${trim(refusal, 90)}`);
      commit();
      continue;
    }

    try {
      await driver.act(decision);
      consecutiveFailures = 0;
      failedHint = undefined;
    } catch (e) {
      consecutiveFailures++;
      failedHint = `${actionSummary(decision)} — ${trim((e as Error).message, 120)}`;
      // failures were previously invisible to stages 2-3: only the next prompt saw them
      event.note = [event.note, `action failed: ${failedHint}`].filter(Boolean).join(" | ");
      console.log(`  ⚠ action failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${trim(failedHint, 90)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        commit();
        exit = {
          kind: "guardrail",
          detail: `${consecutiveFailures} consecutive actions failed ending at step ${step} — page or element appears broken`,
        };
        break;
      }
    }
    commit();
  }

  if (!exit) {
    exit = {
      kind: "guardrail",
      detail: `Ran out of patience after ${persona.patience_steps} steps without completing the goal`,
    };
  }

  return { events, exit };
}

async function verifyGoal(
  brain: Brain & { ask?(prompt: string): Promise<string> },
  goal: string,
  ariaYaml: string,
): Promise<{ achieved: boolean; note: string } | null> {
  try {
    const text = await brain.ask!(buildVerificationPrompt({ goal, ariaYaml }));
    return parseVerdict(text);
  } catch {
    return null; // verification infrastructure failed → treat as inconclusive
  }
}

export interface InboxCheck {
  /** What to show when nothing has ever arrived (empty inbox, failure, no mailbox) */
  text: string;
  /** Rendered messages, set only when this check found new mail */
  mail?: string;
}

/**
 * What the persona sees in their inbox on the next step.
 *
 * The provider reports only NEW messages, so a second check after the code
 * already landed comes back empty — and the code would vanish from the prompt,
 * which is exactly how a working magic-link flow got abandoned as broken. Mail
 * that arrived stays visible, and the "give up waiting" nudge is suppressed
 * once there is something to act on.
 */
export function mergeInbox(check: InboxCheck, arrived?: string): string {
  if (check.mail) return check.mail;
  if (!arrived) return check.text;
  return `${arrived}\n\n(you checked again — nothing NEW arrived, but the message above is still sitting in your inbox. Use it instead of waiting for another one.)`;
}

/** Poll the persona's mailbox, waiting up to `seconds` for something new to arrive. */
async function checkInbox(
  opts: SessionOptions,
  seconds: number,
  onWaited: () => boolean,
): Promise<InboxCheck> {
  if (!opts.mail) {
    return { text: "(no mailbox is configured in this environment — you cannot receive email)" };
  }

  const deadline = Date.now() + seconds * 1000;
  process.stdout.write(`  📬 checking inbox (${seconds}s)...`);
  let msgs: MailMessage[] = [];
  while (Date.now() < deadline) {
    try {
      msgs = await opts.mail.provider.fetchNew(opts.mail.box);
    } catch (e) {
      console.log(` failed`);
      return { text: `inbox check failed: ${trim((e as Error).message, 120)}` };
    }
    if (msgs.length > 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  } else {
    process.stdout.write("\n");
  }

  if (msgs.length === 0) {
    const exhausted = onWaited();
    return {
      text: `(no new mail after waiting ${seconds}s)${
        exhausted ? " — you have now waited longer than your patience allows. You are done waiting; abandon or find another way." : ""
      }`,
    };
  }

  // every email format is different — render each message and let the brain see it
  const canReadFiles = opts.brain.readsFiles ?? false;
  const parts: string[] = [`${msgs.length} new message(s):`];
  for (let i = 0; i < Math.min(msgs.length, 2); i++) {
    const m = msgs[i];
    const codes = extractCodes(m.subject, m.text);
    parts.push(`mail #${i + 1} from ${m.from} — subject: ${m.subject}`);
    if (codes.length) parts.push(`  candidate codes (may include junk): ${codes.join(", ")}`);
    // The body text always ships. A screenshot is a bonus, never the only copy:
    // one email rendered as a blank PNG and the persona, told to read it, saw
    // nothing and walked out of a login flow that was working fine.
    const body = stripInvisible(m.text).replace(/\s+/g, " ").trim();
    if (body) parts.push(`  body: ${trim(body, 600)}`);
    if (canReadFiles) {
      const shot = `${opts.sessionDir}/shots/email-${i + 1}.png`;
      const saved = await opts.driver.emailScreenshot(m.html ?? m.text, shot);
      if (saved) {
        parts.push(`  screenshot of this email (may be blank — trust the text above if so): ${saved}`);
      }
    }
  }
  const mail = parts.join("\n");
  return { text: mail, mail };
}

/**
 * Detect a repeating action pattern, not just an identical one.
 *
 * The old check only caught the same action three times running, so an A-B-A-B
 * ping-pong between two pages ran until patience was exhausted — every step
 * paying for a full page snapshot. Cycle lengths up to 3 are checked, each
 * needing enough repetitions that ordinary exploration cannot trip it.
 */
export function stuckPattern(events: StepEvent[]): string | null {
  const sigs = events.map((e) => JSON.stringify(e.decision.action));
  // period -> repetitions required before we call it a loop
  const PATTERNS: [number, number][] = [
    [1, 3], // same action 3x
    [2, 3], // A-B-A-B-A-B
    [3, 2], // A-B-C-A-B-C
  ];
  for (const [period, reps] of PATTERNS) {
    const span = period * reps;
    if (sigs.length < span) continue;
    const tail = sigs.slice(-span);
    const first = tail.slice(0, period);
    if (tail.every((sig, i) => sig === first[i % period])) {
      return period === 1
        ? `same action repeated ${reps} times`
        : `${period}-step loop repeated ${reps} times`;
    }
  }
  return null;
}

function actionSummary(d: Decision): string {
  switch (d.action.type) {
    case "click":
      return `clicking ${d.action.target}`;
    case "type":
      return `typing into ${d.action.target}`;
    case "select":
      return `selecting "${d.action.value}"`;
    case "scroll":
      return `scrolling ${d.action.direction}`;
    case "back":
      return `going back`;
    case "wait":
      return `pausing`;
    case "check_email":
      return `checking your inbox`;
    default:
      return d.action.type;
  }
}

function trim(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}
