#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BrowserDriver } from "./browser/driver.js";
import { getBrain } from "./brain/index.js";
import { MAX_DECIDE_ATTEMPTS } from "./brain/adapters/cli-brain.js";
import { PERSONAS } from "./persona/presets.js";
import { getPersonaRegistry, newPersonaFile } from "./persona/load.js";
import { generatePersonas } from "./persona/generate.js";
import { MAX_VERIFICATIONS, runSession } from "./session.js";
import { generateReport } from "./log/report.js";
import { generateAggregate, loadSessions } from "./log/aggregate.js";
import { dirLabel, findSessionDirs, sessionPath, siteSlug } from "./runs.js";
import { EXPERTS } from "./experts/index.js";
import type { Brain, ExitReason, Persona, StepEvent } from "./types.js";
import type { MailProvider, Mailbox, MailMessage } from "./mail/types.js";
import { ImapProvider } from "./mail/imap.js";
import { extractCodes, extractLinks } from "./mail/types.js";
import { runDoctor, doctorStateExists } from "./doctor.js";
import { createInterface } from "node:readline/promises";
import { resolveBrainChoice } from "./brain/picker.js";
import {
  PromptCancelled,
  confirmed,
  heading,
  isInteractive,
  multiselect,
  select,
  text,
} from "./ui/prompt.js";
import { readSite } from "./site/read.js";

const MAX_RUNS = 10;

/** Interactive run planner: how many cold/warm/hot, then random order */
async function promptRunPlan(): Promise<string[]> {
  if (!process.stdin.isTTY) {
    console.log("  (non-interactive shell — defaulting to 1 cold run; use --persona or --runs to override)");
    return ["cold"];
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const deadline = Date.now() + 120_000;
  const answer = async (q: string): Promise<string> => {
    // never hang automation: if nobody answers before the deadline, fall back
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "";
    return Promise.race([
      rl.question(q).catch((e) => {
        if ((e as { code?: string }).code === "ABORT_ERR") throw new PromptCancelled();
        throw e;
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), remaining)),
    ]);
  };
  try {
    console.log(`\n  Plan your prospects (max ${MAX_RUNS} total per session):`);
    const ask = async (label: string): Promise<number> => {
      const a = (await answer(`    ${label} runs (0-${MAX_RUNS}): `)).trim();
      const n = parseInt(a || "0", 10);
      return Number.isFinite(n) ? Math.max(0, Math.min(MAX_RUNS, n)) : 0;
    };
    let cold = 0,
      warm = 0,
      hot = 0;
    do {
      cold = await ask("cold");
      warm = await ask("warm");
      hot = await ask("hot");
      if (Date.now() > deadline && cold + warm + hot === 0) {
        console.log("    (no answer — defaulting to 1 cold run)");
        return ["cold"];
      }
      if (cold + warm + hot === 0) console.log("    at least 1 required");
      if (cold + warm + hot > MAX_RUNS) console.log(`    total must be ≤ ${MAX_RUNS}`);
    } while (cold + warm + hot === 0 || cold + warm + hot > MAX_RUNS);

    const queue = [
      ...Array<0>(cold).fill(0).map(() => "cold"),
      ...Array<0>(warm).fill(0).map(() => "warm"),
      ...Array<0>(hot).fill(0).map(() => "hot"),
    ];
    // random order so site sees a natural mix
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return queue;
  } finally {
    rl.close();
  }
}

/** --runs N: N prospects, persona picked at random each time */
function randomRunPlan(n: number): string[] {
  const pool = ["cold", "warm", "hot"];
  return Array.from({ length: Math.min(n, MAX_RUNS) }, () => pool[Math.floor(Math.random() * 3)]);
}

/** Load KEY=VALUE pairs from .env in the cwd (existing env vars win) */
function loadDotEnv() {
  const path = resolve(".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function setupMail(): { provider: MailProvider } | null {
  loadDotEnv();
  const { CLIENTSIM_IMAP_HOST, CLIENTSIM_IMAP_USER, CLIENTSIM_IMAP_PASS, CLIENTSIM_MAIL_DOMAIN } =
    process.env;
  if (!CLIENTSIM_IMAP_HOST || !CLIENTSIM_IMAP_USER || !CLIENTSIM_IMAP_PASS || !CLIENTSIM_MAIL_DOMAIN) {
    return null;
  }
  const provider = new ImapProvider({
    host: CLIENTSIM_IMAP_HOST,
    user: CLIENTSIM_IMAP_USER,
    pass: CLIENTSIM_IMAP_PASS,
    domain: CLIENTSIM_MAIL_DOMAIN,
    tls: process.env.CLIENTSIM_IMAP_TLS !== "false",
    port: process.env.CLIENTSIM_IMAP_PORT ? Number(process.env.CLIENTSIM_IMAP_PORT) : undefined,
  });
  console.log("  mail: IMAP provider configured (ephemeral mailboxes enabled)");
  return { provider };
}

function printUsage() {
  console.log(`client-simulator - synthetic clients that walk your onboarding and report where they leave

USAGE:
  client-simulator visit <url> [options]      stage 1: spawn persona runs (one session per persona)
  client-simulator report [dirs]              stage 2: aggregate funnel report across sessions
  client-simulator fix <dirs...> [options]    stage 3: expert panel reviews sessions -> FIXES.md
  client-simulator all <url> [options]        run 1 -> 2 -> 3 together
  client-simulator doctor [--force]           verify environment (runs automatically on first visit)
  client-simulator personas [--new "Name"]    list personas / scaffold a custom one
  client-simulator personas generate          AI-builds a persona graph from your ideal-customer
                                        description (+ optional --site scrape):
                                          --from "who buys this" --site <url> --count 4
  client-simulator mailtest                   test mailbox create/receive/extract/destroy

  Run \`client-simulator\` with no arguments for a guided wizard (pick command,
  URL, brain, model and effort from menus instead of typing flags).

OPTIONS:
  --persona <list>            explicit persona queue, e.g. cold,warm,hot (max 10)
  --runs <n>                  number of prospects, personas chosen at random (max 10)
  --brain <claude|opencode|codex>   which AI CLI plays the client (prompted if omitted)
  --model <name>              pin the model (prompted if omitted; levels read live from the CLI)
  --effort <level>            reasoning effort (prompted if omitted; claude: low..max,
                              codex: low|medium|high, opencode: no effort knob)
  --headless                  run browser without a visible window
  --mobile                    run at phone viewport (390×844, touch) instead of desktop
  --plan                      re-run the site read + persona plan on a known site
  --force                     re-run checks / regenerate outputs even if up to date
  -h, --help                  show this help

Any of --brain / --model / --effort you omit is asked for with an arrow-key menu;
the model and effort lists are read live from the CLI you pick, so they stay
current. Pass the flags to skip the prompts entirely (and in CI, where there is
no TTY, the defaults apply silently).

The first time you test a site, visit reads the landing page (product, audience,
main CTA) and offers a choice: the built-in personas, or a set generated to fit
that page which you then pick from. Later visits skip straight to persona counts;
--plan re-runs it. With no --persona and no --runs, visit asks interactively how
many cold/warm/hot prospects to send, then shuffles the order randomly.

STAGE COMBINATIONS:
  visit only / report only / fix only (on past sessions) / all — any subset works,
  as long as stages run in order: a stage needs the artifacts of the one before it.`);
}

interface CommonArgs {
  personas?: string[];
  runs?: number;
  /** undefined until --brain is passed or the picker resolves it */
  brain?: string;
  model?: string;
  effort?: string;
  headless: boolean;
  mobile?: boolean;
  /** force the first-visit site read + persona plan on an already-tested site */
  plan?: boolean;
  /** set once the picker has run, so chained stages never ask twice */
  brainResolved?: boolean;
}

function parseCommon(argv: string[]): CommonArgs {
  const args: CommonArgs = { headless: false, mobile: false };
  /** Value flags: a trailing `--persona` used to throw a raw TypeError here. */
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) {
      console.error(`${flag} needs a value. See \`client-simulator --help\`.`);
      process.exit(1);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--personas" || a === "--persona")
      args.personas = value(++i, a).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--runs") args.runs = parseInt(value(++i, a), 10);
    else if (a === "--brain") args.brain = value(++i, a);
    else if (a === "--model") args.model = value(++i, a);
    else if (a === "--effort") args.effort = value(++i, a);
    else if (a === "--headless") args.headless = true;
    else if (a === "--mobile") args.mobile = true;
    else if (a === "--plan") args.plan = true;
  }
  return args;
}

/** A site is "new" until it has its own folder under runs/. */
function isNewSite(url: string): boolean {
  return !existsSync(`runs/${siteSlug(url)}`);
}

/**
 * First-visit planning: show what the site actually is, then let the user decide
 * between the generic built-ins and a persona set generated for this site.
 * Returns the run queue, or null to fall through to the normal planner.
 */
async function planFirstVisit(
  url: string,
  brain: Brain & { ask?(prompt: string): Promise<string> },
): Promise<string[] | null> {
  heading(`New site — ${siteSlug(url)}`);

  process.stdout.write("  \x1b[2mreading the page...\x1b[0m");
  const read = await readSite(url, brain);
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);

  if (read) {
    console.log(`  ${"Product".padEnd(9)} ${read.product}`);
    console.log(`  ${"For".padEnd(9)} ${read.audience}`);
    console.log(`  ${"Main CTA".padEnd(9)} ${read.cta}`);
  } else {
    console.log("  (could not read the page — continuing anyway)");
  }

  const how = await select({
    message: "How do you want to test it?",
    choices: [
      { value: "builtin", label: "built-in personas", hint: "cold / warm / hot — start now" },
      { value: "generate", label: "generate for this site", hint: "personas fitted to this page" },
      { value: "both", label: "both", hint: "generate a set, then also pick built-in counts" },
    ],
  });
  if (how === "builtin") return null;

  const countAnswer = await text({
    message: "How many personas to generate? (2-10, Enter for 6):",
    fallback: "6",
    validate: (v) => (/^\d+$/.test(v) && +v >= 2 && +v <= 10 ? undefined : "give a number from 2 to 10"),
  });

  let generated: { id: string; name: string; temperature: string }[] = [];
  try {
    const { generatePersonas } = await import("./persona/generate.js");
    const result = await generatePersonas({
      description: read ? `${read.audience} (product: ${read.product})` : undefined,
      count: Number(countAnswer),
      brain,
      site: url,
    });
    console.log(result.graph);
    generated = result.written;
  } catch (e) {
    console.error(`\n  persona generation failed: ${(e as Error).message.slice(0, 160)}`);
    console.log("  falling back to the built-in personas.\n");
    return null;
  }

  if (generated.length === 0) {
    console.log("  no personas were written — using the built-ins instead.\n");
    return null;
  }

  const queue = await multiselect({
    message: "Which of them should visit the site? (one run each)",
    choices: generated.map((p) => ({
      value: p.id,
      label: p.id,
      hint: `${p.name} — ${p.temperature}`,
    })),
  });

  if (how === "both") {
    console.log("");
    return [...queue, ...(await promptRunPlan())];
  }
  return queue;
}

/** Resolve the run queue: explicit personas > --runs N > interactive planner */
async function resolveRunPlan(
  common: CommonArgs,
  url: string,
  brain: Brain & { ask?(prompt: string): Promise<string> },
): Promise<string[]> {
  if (common.personas?.length) {
    if (common.personas.length > MAX_RUNS) common.personas = common.personas.slice(0, MAX_RUNS);
    return common.personas;
  }
  if (common.runs && common.runs > 0) return randomRunPlan(common.runs);

  // a site you have never tested gets a one-time read + persona plan
  if (isInteractive() && (common.plan || isNewSite(url))) {
    const planned = await planFirstVisit(url, brain);
    if (planned?.length) return planned.slice(0, MAX_RUNS);
  }
  return promptRunPlan();
}

/**
 * Resolve the brain for a stage, prompting for whatever the flags left open.
 * Mutates `common` so chained stages (all -> fix) reuse the same answers
 * instead of asking again.
 */
async function resolveBrain(common: CommonArgs, purpose?: string) {
  try {
    if (!common.brainResolved) {
      const choice = await resolveBrainChoice(
        { brain: common.brain, model: common.model, effort: common.effort },
        purpose,
      );
      common.brain = choice.brain;
      common.model = choice.model;
      common.effort = choice.effort;
      common.brainResolved = true;
    }
    return getBrain(common.brain ?? "claude", { model: common.model, effort: common.effort });
  } catch (e) {
    if (e instanceof PromptCancelled) throw e;
    console.error((e as Error).message);
    process.exit(1);
  }
}

/** Human-readable summary of the resolved brain config, for run banners. */
function describeRun(common: CommonArgs): string {
  const parts = [`brain: ${common.brain ?? "claude"}`];
  if (common.model) parts.push(`model: ${common.model}`);
  if (common.effort) parts.push(`effort: ${common.effort}`);
  return parts.join(" | ");
}

/** STAGE 1 — spawn persona visits. Returns created session dirs. */
async function visit(url: string, common: CommonArgs): Promise<string[]> {
  const planningBrain = await resolveBrain(common, "Which AI plays the client?");

  // first-run initialization check (skipped silently once verified)
  if (!doctorStateExists()) {
    const ok = await runDoctor(common.brain);
    if (!ok) process.exit(1);
  }

  const personaIds = await resolveRunPlan(common, url, planningBrain);
  const registry = getPersonaRegistry();
  for (const pid of personaIds) {
    if (!registry.personas[pid]) {
      console.error(
        `Unknown persona "${pid}". Available: ${Object.keys(registry.personas).join(", ")} (or add YAML files in personas/)`,
      );
      process.exit(1);
    }
  }

  const dirs: string[] = [];
  const mail = setupMail();
  if (!mail) {
    // with a mailbox the harness forces every typed address to the ephemeral
    // one; without it, whatever the brain invents is what real signup forms get
    console.warn(
      `\n  ⚠ no mailbox configured — personas will invent email addresses and may sign real\n` +
        `    inboxes up to ${siteSlug(url)}. Set CLIENTSIM_IMAP_* (see README) to give each run a\n` +
        `    throwaway address the harness enforces, and to let personas read verification mail.`,
    );
  }

  // A step is usually one call, but decide() retries a malformed reply and each
  // attempt is its own CLI call. Completion checks (max 2 per session) do not
  // retry. Experts are stage 3 and counted there.
  const steps = personaIds.reduce((n, pid) => n + registry.personas[pid].patience_steps, 0);
  const checks = personaIds.length * MAX_VERIFICATIONS;
  console.log(
    `\n  ${personaIds.length} prospect(s) queued: ${personaIds.join(", ")} | ${describeRun(common)}`,
  );
  console.log(
    `  stage 1 budget: ~${steps + checks} AI calls, up to ${steps * MAX_DECIDE_ATTEMPTS + checks} if replies need retrying` +
      ` (personas stop earlier when they finish or leave)\n`,
  );

  for (const pid of personaIds) {
    const persona: Persona = registry.personas[pid];
    const sessionDir = sessionPath(url, pid);
    mkdirSync(`${sessionDir}/shots`, { recursive: true });

    // EPHEMERAL MAILBOX: created per persona run, destroyed after
    let box: Mailbox | undefined;
    if (mail) {
      box = await mail.provider.create(pid);
    }

    // fresh brain per persona — a shared one would carry the previous
    // persona's whole conversation into this one's first impression
    const brain = getBrain(common.brain ?? "claude", {
      model: common.model,
      effort: common.effort,
      allowDir: sessionDir, // so the persona can read its own screenshots
    });

    const driver = new BrowserDriver();
    try {
      await driver.launch({
        headless: common.headless,
        shotsDir: `${sessionDir}/shots`,
        mobile: common.mobile,
        videoDir: `${sessionDir}/.video`,
      });
      let events: StepEvent[] = [];
      let exit: ExitReason;
      try {
        ({ events, exit } = await runSession({
          url,
          persona,
          brain,
          driver,
          sessionDir,
          mail: mail && box ? { provider: mail.provider, box } : undefined,
        }));
      } catch (e) {
        const detail = (e as Error).message.split("\n")[0];
        console.log(`\n  session failed: ${detail}`);
        exit = { kind: "guardrail", detail: `Session could not run: ${detail}` };
      }

      writeFileSync(
        `${sessionDir}/report.md`,
        generateReport({ persona, url, brain: describeRun(common), events, exit, usage: (brain as { usage?: never }).usage }),
      );
      writeFileSync(
        `${sessionDir}/meta.json`,
        JSON.stringify(
          {
            url,
            personaId: pid,
            brain: brain.name,
            model: common.model ?? null,
            effort: common.effort ?? null,
            usage: (brain as { usage?: unknown }).usage ?? null,
            exit,
            viewport: common.mobile ? "mobile" : "desktop",
          },
          null,
          2,
        ),
      );
      dirs.push(sessionDir);

      printSessionSummary(exit, events, sessionDir, dirs.length, personaIds.length);
    } finally {
      // before close(), and in finally, so an error mid-session still yields a video
      await driver.saveVideo(`${sessionDir}/video.webm`).catch(() => {});
      await driver.close();
      if (mail && box) {
        process.stdout.write("  🗑 destroying mailbox...");
        try {
          await mail.provider.destroy(box);
          await (mail.provider as ImapProvider).close?.();
          console.log(" gone");
        } catch (e) {
          console.log(` failed: ${(e as Error).message.slice(0, 100)}`);
        }
      }
    }
  }
  return dirs;
}

function printSessionSummary(
  exit: ExitReason,
  events: StepEvent[],
  sessionDir: string,
  n: number,
  total: number,
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  [${n}/${total}] ${exit.kind.toUpperCase()}`);
  if (exit.kind === "abandoned") {
    const last = events[events.length - 1];
    console.log(`  Where: step ${last?.n} on ${last?.url}`);
    console.log(`  Why: "${exit.reason}"`);
    console.log(`  Wanted answered: "${exit.question}"`);
  }
  if (exit.kind === "completed") console.log(`  ${exit.summary}`);
  if (exit.kind === "guardrail") console.log(`  ${exit.detail}`);
  console.log(`  Session: ${sessionDir}`);
}

/**
 * STAGE 2 — aggregate per site. A funnel that mixed several websites together
 * would be meaningless, so each site gets its own runs/<site>/AGGREGATE.md.
 */
async function report(dirs: string[] | undefined, force = false) {
  const targets = dirs?.length ? dirs : findSessionDirs();
  if (targets.length === 0) {
    console.error(
      "Nothing to report on. Stage 2 needs stage 1 output — run `client-simulator visit <url>` first.",
    );
    process.exit(1);
  }

  // group by the site each session actually visited, not by where it sits on disk
  const bySite = new Map<string, string[]>();
  for (const s of loadSessions(targets)) {
    const site = siteSlug(s.meta.url);
    bySite.set(site, [...(bySite.get(site) ?? []), s.dir]);
  }

  if (bySite.size === 0) {
    console.error("No readable sessions (missing meta.json or session.jsonl).");
    process.exit(1);
  }

  let written = 0;
  for (const [site, siteDirs] of bySite) {
    const out = `runs/${site}/AGGREGATE.md`;
    const manifestPath = `runs/${site}/.aggregate-manifest.json`;

    if (!force && existsSync(manifestPath) && existsSync(out)) {
      try {
        const prev = JSON.parse(readFileSync(manifestPath, "utf8")) as { dirs: string[] };
        const same =
          prev.dirs.length === siteDirs.length &&
          prev.dirs.every((d, i) => resolve(d) === resolve(siteDirs[i]));
        if (same) {
          console.log(`  ${site}: up to date (${siteDirs.length} sessions) — --force to regenerate`);
          continue;
        }
        console.log(`  ${site}: ${prev.dirs.length} → ${siteDirs.length} sessions, regenerating...`);
      } catch {
        // corrupt manifest → regenerate
      }
    }

    mkdirSync(`runs/${site}`, { recursive: true });
    writeFileSync(out, generateAggregate(siteDirs));
    writeFileSync(manifestPath, JSON.stringify({ dirs: siteDirs }, null, 2));
    console.log(`  ${site}: ${siteDirs.length} session(s) → ${resolve(out)}`);
    written++;
  }

  if (written > 0) console.log("");
}

/** The aggregate that covers a given session. */
function aggregatePathFor(url: string): string {
  return `runs/${siteSlug(url)}/AGGREGATE.md`;
}

/** STAGE 3 — expert panel over sessions. Requires stage 2 (aggregate) unless forced. */
async function fix(dirs: string[], common: CommonArgs, force = false) {
  if (dirs.length === 0) {
    console.error(
      "Usage: client-simulator fix <dir> [moreDirs...] [--brain ...] [--force]",
    );
    process.exit(1);
  }

  const sessions = loadSessions(dirs);
  if (sessions.length === 0) {
    console.error("No valid sessions (missing meta.json or session.jsonl).");
    process.exit(1);
  }

  const ungated = sessions.filter((s) => !existsSync(aggregatePathFor(s.meta.url)));
  if (!force && ungated.length > 0) {
    const missing = [...new Set(ungated.map((s) => aggregatePathFor(s.meta.url)))];
    console.error(
      `Stage 3 needs stage 2 — missing ${missing.join(", ")}. Run \`client-simulator report\` first (or add --force to skip the aggregate).`,
    );
    process.exit(1);
  }

  // resolves the brain/model/effort choice; each expert then gets its own instance
  await resolveBrain(common, "Which AI runs the expert panel?");

  for (const s of sessions) {
    if (!force && existsSync(`${s.dir}/FIXES.md`)) {
      console.log(
        `\n  ${dirLabel(s.dir)}: FIXES.md already exists — skipping (--force to re-run experts).`,
      );
      continue;
    }
    const registry = getPersonaRegistry();
    const persona = registry.personas[s.meta.personaId] ?? PERSONAS.cold;
    console.log(
      `\n  Expert panel: ${persona.name} @ ${s.meta.url} (${s.events.length} steps)`,
    );
    console.log(`  Experts: ${EXPERTS.map((e) => e.id).join(", ")} (${EXPERTS.length} AI calls)`);

    const sections: string[] = [];
    for (const expert of EXPERTS) {
      process.stdout.write(`  [${expert.id}] ${expert.title}...`);
      // fresh brain per expert — independent verdicts, not a group conversation
      const expertBrain = getBrain(common.brain ?? "claude", {
        model: common.model,
        effort: common.effort,
        role: "expert",
        allowDir: s.dir,
      });
      const section = await expert.run(
        { persona, url: s.meta.url, events: s.events, exit: s.meta.exit, viewport: (s.meta as any).viewport },
        expertBrain,
      );
      if (process.stdout.isTTY) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      } else {
        process.stdout.write("\n");
      }
      if (section) {
        console.log(`  [${expert.id}] done`);
        sections.push(`## ${expert.title} — ${expert.id}\n\n${section}`);
      } else {
        console.log(`  [${expert.id}] skipped`);
      }
    }

    if (sections.length === 0) continue;

    const doc = `# Expert Fixes\n\nSession: \`${s.dir}\`\nSite: ${s.meta.url}\nPersona: ${persona.name} (${persona.temperature})\n\n---\n\n${sections.join("\n---\n\n")}\n`;
    writeFileSync(`${s.dir}/FIXES.md`, doc);
    console.log(`  Fixes → ${s.dir}/FIXES.md`);
  }
}

/** PIPELINE — visit → report → fix (pipeline always regenerates: it just made new data) */
async function all(url: string, common: CommonArgs) {
  const dirs = await visit(url, common);
  await report(dirs, true);
  // common now carries the resolved brain/model/effort — stage 3 reuses it verbatim
  await fix(dirs, common, true);
  const sites = [...new Set(loadSessions(dirs).map((x) => siteSlug(x.meta.url)))];
  console.log(
    `\n  Pipeline complete: ${dirs.length} session(s). See ${sites
      .map((x) => `runs/${x}/AGGREGATE.md`)
      .join(", ")} + FIXES.md per session.\n`,
  );
}

/** Mailbox lifecycle test: create -> wait for real mail -> extract -> destroy */
async function mailtest() {
  const mail = setupMail();
  if (!mail) {
    console.error(
      "Set CLIENTSIM_IMAP_HOST, CLIENTSIM_IMAP_USER, CLIENTSIM_IMAP_PASS, CLIENTSIM_MAIL_DOMAIN first (see README).",
    );
    process.exit(1);
  }

  const box = await mail.provider.create("mailtest");
  console.log(`\n  ✅ mailbox created: ${box.address}`);
  console.log(`\n  → Send any email to that address now (from another account).\n`);

  const deadline = Date.now() + 120_000;
  let msgs: MailMessage[] = [];
  try {
    while (Date.now() < deadline) {
      msgs = await mail.provider.fetchNew(box);
      if (msgs.length > 0) break;
      process.stdout.write("  waiting for mail...\r");
      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`\n\n  ❌ inbox check failed: ${msg.slice(0, 200)}`);
    if (msg.includes("AUTHENTICATIONFAILED")) {
      console.log(`
  Gmail says the credentials are wrong. Checklist:
    1. IMAP enabled: mail.google.com → gear → See all settings → Forwarding and POP/IMAP → Enable IMAP
    2. CLIENTSIM_IMAP_PASS must be a 16-char APP PASSWORD (not your login password)
       → myaccount.google.com/apppasswords (requires 2-Step Verification)
    3. Paste it without extra characters, e.g. "abcd efgh ijkl mnop"`);
    }
    process.exit(1);
  }
  console.log("");

  if (msgs.length === 0) {
    console.log("  ⏱ no mail arrived within 2 minutes.");
  } else {
    for (const m of msgs) {
      console.log(`  📩 from: ${m.from}`);
      console.log(`     subject: ${m.subject}`);
      console.log(`     codes: ${extractCodes(m.subject, m.text).join(", ") || "none"}`);
      console.log(`     links: ${extractLinks(m.text).join(", ") || "none"}`);
    }
  }

  await mail.provider.destroy(box);
  const after = await mail.provider.fetchNew(box);
  console.log(`\n  🗑 mailbox destroyed. messages remaining addressed to it: ${after.length}\n`);
  await (mail.provider as ImapProvider).close?.();
}

/** Generate a persona graph from a description (+ optional site scrape) */
async function personasGenerate(rest: string[]) {
  const brain = await resolveBrain(parseCommon(rest), "Which AI writes your personas?");

  const flagValue = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  let description = flagValue("--from");
  let site = flagValue("--site");
  let count = flagValue("--count") ? parseInt(flagValue("--count")!, 10) : undefined;

  const interactive = !description || !site;
  if (interactive && !process.stdin.isTTY) {
    // automation: require flags
  } else if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const deadline = Date.now() + 180_000;
    const ask = async (q: string): Promise<string> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return "";
      return Promise.race([
        rl.question(q),
        new Promise<string>((res) => setTimeout(() => res(""), remaining)),
      ]);
    };
    try {
      if (!site) {
        site = (await ask("  Target site (optional, scraped to learn the product): ")).trim();
      }
      if (!description) {
        description = (
          await ask("  Who is this for? (optional if a site was given — Enter to infer): ")
        ).trim();
      }
    } finally {
      rl.close();
    }
  }

  // a scraped site is enough on its own — the audience is inferred from the page
  if (!description && !site) {
    console.error(
      '\n  Need either a site to scrape or a description of who this is for:\n    client-simulator personas generate --site https://yoursite.com\n    client-simulator personas generate --from "CTOs at Series B startups"',
    );
    process.exit(1);
  }

  const effectiveCount = count && count > 0 ? Math.min(count, 10) : 4;
  console.log(`\n  generating ${effectiveCount} personas with ${brain.name}...`);

  try {
    const { written, graph } = await generatePersonas({
      description,
      count: effectiveCount,
      brain: brain as typeof brain & { ask?: (p: string) => Promise<string> },
      site: site || undefined,
    });
    console.log(graph);
    console.log(`\n  ✓ ${written.length} persona file(s) written to personas/:`);
    for (const p of written) console.log(`    ${p.id}.yaml — ${p.name} (${p.temperature})`);
    console.log(`\n  Run them:`);
    console.log(`    client-simulator visit <url> --persona ${written.map((p) => p.id).join(",")}\n`);
  } catch (e) {
    console.error(`\n  generation failed: ${(e as Error).message.slice(0, 200)}\n`);
    process.exit(1);
  }
}

/** List available personas (built-in + custom YAML) */
function personasCommand(args: string[]) {
  if (args.includes("--new")) {
    const nameIdx = args.indexOf("--new");
    const name = args[nameIdx + 1];
    if (!name || name.startsWith("--")) {
      console.error("Usage: client-simulator personas --new \"Persona Name\"");
      process.exit(1);
    }
    try {
      const path = newPersonaFile(name);
      console.log(`\n  ✓ created ${path}`);
      console.log(`  Edit it, then use: client-simulator visit <url> --persona ${path.split("/").pop()?.replace(/\.yaml$/, "")}\n`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  const { personas, errors } = getPersonaRegistry();
  console.log(`\n  Available personas (--persona <id>):\n`);
  console.log(`  ${"id".padEnd(22)} name`.padEnd(50) + "temperature  patience");
  console.log(`  ${"─".repeat(70)}`);
  for (const [id, p] of Object.entries(personas)) {
    const custom = PERSONAS[id] ? "" : "  (custom)";
    console.log(
      `  ${id.padEnd(22)} ${p.name.padEnd(28)} ${p.temperature.padEnd(11)} ${p.patience_steps}${custom}`,
    );
  }
  if (errors.length > 0) {
    console.log(`\n  ⚠ invalid persona files (not loaded):`);
    for (const e of errors) console.log(`    ${e.file}: ${e.error}`);
  }
  console.log(`\n  Add your own: client-simulator personas --new "My Persona"  →  personas/<id>.yaml\n`);
}

/** Normalize whatever the user typed into a fetchable URL. */
async function askUrl(): Promise<string> {
  const raw = await text({
    message: "Site URL:",
    validate: (v) =>
      /^(https?:\/\/)?[^\s.\/]+\.[^\s]+$/.test(v) ? undefined : "that doesn't look like a URL",
  });
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

/**
 * Zero-argument entry point: a guided wizard over every stage, so nothing has
 * to be memorised. Falls back to the usage text when there is no TTY.
 */
async function wizard() {
  if (!isInteractive()) {
    printUsage();
    process.exit(1);
  }

  heading("client-simulator");
  const action = await select({
    message: "What do you want to do?",
    choices: [
      { value: "visit", label: "visit", hint: "send synthetic clients through a site" },
      { value: "all", label: "all", hint: "visit -> report -> fix, one shot" },
      { value: "report", label: "report", hint: "aggregate past sessions into a funnel" },
      { value: "fix", label: "fix", hint: "expert panel on a past session" },
      { value: "personas", label: "personas", hint: "list or generate personas" },
      { value: "doctor", label: "doctor", hint: "verify your environment" },
    ],
  });

  const common: CommonArgs = { headless: false, mobile: false };

  switch (action) {
    case "visit":
      await visit(await askUrl(), common);
      break;
    case "all":
      await all(await askUrl(), common);
      break;
    case "report":
      await report(undefined, false);
      break;
    case "fix": {
      const dirs = findSessionDirs();
      if (dirs.length === 0) {
        console.error("\n  No sessions to review yet — run a visit first.\n");
        process.exit(1);
      }
      const dir = await select({
        message: "Which session?",
        // show site/date/run, not just the leaf, so sessions stay distinguishable
        choices: [...dirs].reverse().map((d) => ({ value: d, label: dirLabel(d) })),
      });
      // stage 3 is gated on stage 2; in a guided flow just produce it
      await report(undefined, false);
      await fix([dir], common, false);
      break;
    }
    case "personas": {
      const sub = await select({
        message: "Personas:",
        choices: [
          { value: "list", label: "list", hint: "show built-in + custom" },
          { value: "generate", label: "generate", hint: "AI-build a persona graph" },
        ],
      });
      if (sub === "list") personasCommand([]);
      else await personasGenerate([]);
      break;
    }
    case "doctor": {
      const choice = await resolveBrainChoice({}, "Which AI should I health-check?", {
        requireInstalled: false,
      });
      if (!(await runDoctor(choice.brain, true))) process.exitCode = 1;
      break;
    }
  }
}

async function main() {
  loadDotEnv();
  const [command, ...rest] = process.argv.slice(2);

  if (!command) {
    await wizard();
    return;
  }
  if (command === "-h" || command === "--help") {
    printUsage();
    process.exit(0);
  }

  const positionals: string[] = [];
  const VALUE_FLAGS = new Set(["--persona", "--personas", "--brain", "--runs", "--model", "--effort"]);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      if (VALUE_FLAGS.has(rest[i])) i++; // skip this flag's value
      continue;
    }
    positionals.push(rest[i]);
  }

  const common = parseCommon(rest);

  switch (command) {
    case "visit": {
      const url = positionals[0];
      if (!url) {
        console.error("Usage: client-simulator visit <url> [--persona cold,warm,hot]");
        process.exit(1);
      }
      await visit(url, common);
      break;
    }
    case "report":
      await report(
        positionals.length ? positionals : undefined,
        rest.includes("--force"),
      );
      break;
    case "fix":
      await fix(positionals, common, rest.includes("--force"));
      break;
    case "all": {
      const url = positionals[0];
      if (!url) {
        console.error("Usage: client-simulator all <url> [--persona cold,warm,hot]");
        process.exit(1);
      }
      await all(url, common);
      break;
    }
    case "mailtest":
      await mailtest();
      break;
    case "doctor": {
      const choice = await resolveBrainChoice(
        { brain: common.brain, model: common.model, effort: common.effort },
        "Which AI should I health-check?",
        { requireInstalled: false },
      );
      if (!(await runDoctor(choice.brain, rest.includes("--force")))) process.exitCode = 1;
      break;
    }
    case "personas": {
      if (rest[0] === "generate") {
        await personasGenerate(rest.slice(1));
      } else {
        personasCommand(rest);
      }
      break;
    }
    default:
      // legacy style: client-simulator <url> ...
      await visit([command, ...positionals][0], common);
      break;
  }
}

main().catch((e) => {
  if (e instanceof PromptCancelled) {
    console.log("\n  cancelled.\n");
    process.exit(130);
  }
  console.error(e);
  process.exit(1);
});
