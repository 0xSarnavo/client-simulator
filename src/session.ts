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
import { parseVerdict } from "./brain/adapters/cli-brain.js";
import { FORBIDDEN_URL_PATTERNS } from "./types.js";
import type { MailProvider, Mailbox, MailMessage } from "./mail/types.js";
import { formatMessages } from "./mail/types.js";

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
const MAX_VERIFICATIONS = 2;

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

    // HARD SAFETY SCOPE: never follow the journey into payment/billing territory
    if (FORBIDDEN_URL_PATTERNS.some((p) => p.test(snap.url))) {
      exit = {
        kind: "guardrail",
        detail: `Safety scope reached at step ${step}: journey entered a payment/billing page (${snap.url}). The agent never pays — this is recorded as the wall it hit.`,
      };
      break;
    }

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

    // GUARDRAIL: identical-action loop
    if (isStuck(events)) {
      events.push(event);
      appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
      exit = {
        kind: "guardrail",
        detail: `Stuck loop detected at step ${step}: same action repeated 3 times on ${snap.url}`,
      };
      break;
    }

    // LOG
    events.push(event);
    appendFileSync(jsonlPath, JSON.stringify(event) + "\n");

    // ACT — check_email is handled by the mail layer, not the browser
    if (decision.action.type === "check_email") {
      const waitSeconds = decision.action.seconds;
      emailResult = await checkInbox(opts, waitSeconds, () => {
        emailWaitSeconds += waitSeconds;
        return emailWaitSeconds > (persona.otp_patience_seconds ?? 180);
      });
      consecutiveFailures = 0;
      continue; // no page change; next think sees the inbox result
    }

    try {
      await driver.act(decision);
      consecutiveFailures = 0;
      failedHint = undefined;
    } catch (e) {
      consecutiveFailures++;
      failedHint = `${actionSummary(decision)} — ${trim((e as Error).message, 120)}`;
      console.log(`  ⚠ action failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${trim(failedHint, 90)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        exit = {
          kind: "guardrail",
          detail: `${consecutiveFailures} consecutive actions failed ending at step ${step} — page or element appears broken`,
        };
        break;
      }
    }
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

/** Poll the persona's mailbox, waiting up to `seconds` for something new to arrive. */
async function checkInbox(
  opts: SessionOptions,
  seconds: number,
  onWaited: () => boolean,
): Promise<string> {
  if (!opts.mail) return "(no mailbox is configured in this environment — you cannot receive email)";

  const deadline = Date.now() + seconds * 1000;
  process.stdout.write(`  📬 checking inbox (${seconds}s)...`);
  let msgs: MailMessage[] = [];
  while (Date.now() < deadline) {
    try {
      msgs = await opts.mail.provider.fetchNew(opts.mail.box);
    } catch (e) {
      console.log(` failed`);
      return `inbox check failed: ${trim((e as Error).message, 120)}`;
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
    return `(no new mail after waiting ${seconds}s)${
      exhausted ? " — you have now waited longer than your patience allows. You are done waiting; abandon or find another way." : ""
    }`;
  }
  return `${msgs.length} new message(s):\n\n${formatMessages(msgs)}`;
}

function isStuck(events: StepEvent[]): boolean {
  if (events.length < 3) return false;
  const sig = (e: StepEvent) => JSON.stringify(e.decision.action);
  const a = sig(events[events.length - 1]);
  return (
    sig(events[events.length - 2]) === a &&
    sig(events[events.length - 3]) === a
  );
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
