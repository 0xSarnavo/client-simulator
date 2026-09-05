#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BrowserDriver } from "./browser/driver.js";
import { getBrain } from "./brain/index.js";
import { PERSONAS } from "./persona/presets.js";
import {
  PERSONAS_DIR,
  getPersonaRegistry,
  loadCustomPersonas,
  newPersonaFile,
  siteOwnPersonas,
  sitePersonasDir,
  sitesWithPersonas,
} from "./persona/load.js";
import { generatePersonas } from "./persona/generate.js";
import { stringify as stringifyYaml } from "yaml";
import { runSession } from "./session.js";
import { generateReport, journeySeconds } from "./log/report.js";
import { generateAggregate, loadSessions } from "./log/aggregate.js";
import { RUNS_ROOT, dirLabel, findSessionDirs, sessionPath, siteSlug } from "./runs.js";
import { EXPERTS } from "./experts/index.js";
import type { Brain, ExitReason, Persona, StepEvent } from "./types.js";
import type { MailProvider, Mailbox, MailMessage } from "./mail/types.js";
import { ImapProvider, type ImapConfig } from "./mail/imap.js";
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
import { arrivalFor, blockedPath, blockedReason, ensureBrief, hasBrief, icpSeed, loadBrief } from "./site/brief.js";
import { htmlToPdf, packetFor, packetHtml } from "./log/pdf.js";
import { draftFlow, loadFlow, scoreFlow, type Flow } from "./site/flow.js";

const MAX_RUNS = 10;
/** Stages, in the order they must run. `--stop <stage>` ends after one of these. */
const STAGES = ["site", "personas", "visit", "report", "fix"] as const;
type Stage = (typeof STAGES)[number];

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
/**
 * `--runs N` draws from the personas built for this site when it has any, and
 * only falls back to cold/warm/hot when it does not. Drawing from the built-ins
 * on a site with its own set would silently ignore the set that was just
 * generated for it.
 */
function randomRunPlan(n: number, url?: string): string[] {
  const site = url ? Object.keys(siteOwnPersonas(url)) : [];
  const pool = site.length ? site : ["cold", "warm", "hot"];
  return Array.from(
    { length: Math.min(n, MAX_RUNS) },
    () => pool[Math.floor(Math.random() * pool.length)],
  );
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

function mailConfig(): ImapConfig | null {
  loadDotEnv();
  const { CLIENTSIM_IMAP_HOST, CLIENTSIM_IMAP_USER, CLIENTSIM_IMAP_PASS, CLIENTSIM_MAIL_DOMAIN } =
    process.env;
  if (!CLIENTSIM_IMAP_HOST || !CLIENTSIM_IMAP_USER || !CLIENTSIM_IMAP_PASS || !CLIENTSIM_MAIL_DOMAIN) {
    return null;
  }
  return {
    host: CLIENTSIM_IMAP_HOST,
    user: CLIENTSIM_IMAP_USER,
    pass: CLIENTSIM_IMAP_PASS,
    domain: CLIENTSIM_MAIL_DOMAIN,
    tls: process.env.CLIENTSIM_IMAP_TLS !== "false",
    port: process.env.CLIENTSIM_IMAP_PORT ? Number(process.env.CLIENTSIM_IMAP_PORT) : undefined,
  };
}

function setupMail(): { provider: MailProvider } | null {
  const cfg = mailConfig();
  if (!cfg) return null;
  console.log("  mail: IMAP provider configured (ephemeral mailboxes enabled)");
  return { provider: new ImapProvider(cfg) };
}

function printUsage() {
  console.log(`client-simulator - synthetic clients that walk your onboarding and report where they leave

USAGE:
  client-simulator <url> [options]

  That is the whole tool. Point it at a site and it reads the page, writes a
  brief, builds prospects who fit the product, sends them through, aggregates
  the funnel, and runs the expert panel. It asks only what it cannot work out.

    client-simulator firecrawl.dev                  the lot
    client-simulator firecrawl.dev --yes            the lot, asking nothing
    client-simulator firecrawl.dev --stop personas  just read it and build prospects
    client-simulator firecrawl.dev --persona cold --headless

  Run it bare for a guided flow: \`client-simulator\`

STAGES, in order:
  site      read the page  -> runs/<site>/SITE.md
  personas  build prospects-> runs/<site>/personas/
  visit     send them      -> one session each
  report    the funnel     -> runs/<site>/AGGREGATE.md
  fix       expert panel   -> FIXES.md per session

  --stop <stage>              end after that one (default: run them all)
  --flow "<intent>"           the flow to test, e.g. "signup through to the
                              dashboard" — checkpoints are drafted for review,
                              sessions are scored against them (runs/<site>/FLOW.md)
  --plan                      re-read the site and rebuild its personas
  --force                     regenerate outputs that are already up to date

WHO GOES IN:
  --persona <list>            explicit queue, e.g. cold,warm,hot (max 10)
  --runs <n>                  n prospects, chosen at random (max 10)
                              omit both and it offers the personas built for this site

HOW IT RUNS:
  --brain <claude|opencode|codex>   which AI CLI plays the client
  --model <name>              pin the model (lists are read live from the CLI)
  --effort <level>            reasoning effort (claude: low..max, codex: low|medium|high)
  --time <minutes>            wall-clock ceiling per session (default 20; waiting
                              on mail and pauses is excluded — slow mail is not
                              the site's fault)
  --headless                  no visible browser window
  --mobile                    phone viewport (390x844, touch) instead of desktop
  --yes                       never prompt; take the default for every question

ON ITS OWN:
  --report [dirs...]          aggregate past sessions into a funnel
                              add --by-model for a funnel per model too
  --fix <dirs...>             expert panel over past sessions -> FIXES.md
  --pdf [sites...]            one shareable PDF per site (funnel + all fixes)
  --doctor                    verify the environment
  --list-personas             show every persona, built-in and custom
  --new-persona "Name"        build one by answering a few questions
  --mailtest                  test mailbox create/receive/extract/destroy
  -h, --help                  this

PER SITE, ON DISK:
  runs/<site>/SITE.md         what the page sells, to whom, its walls and tripwires
  runs/<site>/personas/       the prospects built for this product
  runs/<site>/AGGREGATE.md    the funnel across every session

Prior knowledge is rationed by temperature, because that is most of what makes
the three behave differently: cold arrives knowing nothing, warm knows what it
came for, hot already looked up the price and how to sign up.`);
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
  /** wall-clock minutes per session; waiting on mail/`wait` is excluded */
  time?: number;
  /** the flow to test, e.g. "signup through to the dashboard" */
  flow?: string;
  /** force the site read + persona rebuild on an already-tested site */
  plan?: boolean;
  /** set once the picker has run, so chained stages never ask twice */
  brainResolved?: boolean;
  /** never prompt — take the default for every question */
  yes?: boolean;
  /** last stage to run; undefined means all three */
  stop?: Stage;
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
    else if (a === "--time") {
      const t = parseInt(value(++i, a), 10);
      if (!Number.isFinite(t) || t < 1 || t > 120) {
        console.error(`--time takes minutes from 1 to 120. Got "${argv[i]}".`);
        process.exit(1);
      }
      args.time = t;
    }
    else if (a === "--flow") args.flow = value(++i, a);
    else if (a === "--brain") args.brain = value(++i, a);
    else if (a === "--model") args.model = value(++i, a);
    else if (a === "--effort") args.effort = value(++i, a);
    else if (a === "--stop") {
      const s = value(++i, a);
      if (!(STAGES as readonly string[]).includes(s)) {
        console.error(`--stop takes one of: ${STAGES.join(", ")}. Got "${s}".`);
        process.exit(1);
      }
      args.stop = s as Stage;
    } else if (a === "--headless") args.headless = true;
    else if (a === "--mobile") args.mobile = true;
    else if (a === "--plan") args.plan = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
  }
  return args;
}

/** Does this stage run, given --stop? */
function runsThrough(stage: Stage, stop?: Stage): boolean {
  return !stop || STAGES.indexOf(stage) <= STAGES.indexOf(stop);
}

/** A 24-wide ASCII progress bar: `[#########---------------] 3/8 label`. */
function progressBar(done: number, total: number, label = ""): string {
  const w = 24;
  const filled = total > 0 ? Math.round((done / total) * w) : 0;
  return `  [${"#".repeat(filled)}${"-".repeat(w - filled)}] ${done}/${total}${label ? ` ${label}` : ""}`;
}

/** `▸ stage 3/5 · visit` — where we are in the pipeline for this site. */
function stageBanner(stage: Stage, stop?: Stage): void {
  const active = STAGES.filter((s) => runsThrough(s, stop));
  const i = active.indexOf(stage);
  if (i === -1) return;
  console.log(`\n▸ stage ${i + 1}/${active.length} · ${stage}`);
}

/**
 * Make sure `runs/<site>/SITE.md` exists before anyone is sent in.
 *
 * This runs on every visit to a site that has no brief yet — including when
 * --persona was passed. That ordering is the whole point: the brief used to sit
 * behind the interactive planner, so `--persona cold` skipped it and the persona
 * arrived knowing nothing about the product. It then spent its whole patience
 * working out what the site was and the run was filed as a site failure.
 */
async function prepareSite(
  url: string,
  common: CommonArgs,
  brain: Brain & { ask?(prompt: string): Promise<string> },
): Promise<void> {
  // a site already marked blocked is not re-scraped every run; --plan re-checks
  if (common.plan) rmSync(blockedPath(url), { force: true });
  else if (blockedReason(url)) return;

  const fresh = !hasBrief(url);
  if (!fresh && !common.plan) return;

  heading(fresh ? `New site — ${siteSlug(url)}` : `Re-reading ${siteSlug(url)}`);
  process.stdout.write("  \x1b[2mreading the page...\x1b[0m");
  const brief = await ensureBrief(url, brain, { force: common.plan });
  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }

  if (!brief) {
    console.log("  (could not read the page — personas will go in cold)\n");
    return;
  }
  // the table rows are the summary worth seeing; the rest is in the file
  for (const line of brief.split("\n")) {
    const row = line.match(/^\| \*\*(.+?)\*\* \| (.+?) \|$/);
    if (row) console.log(`  ${row[1].padEnd(9)} ${row[2]}`);
  }
  console.log(`\n  brief: ${briefPathLabel(url)}\n`);
}

function briefPathLabel(url: string): string {
  return `runs/${siteSlug(url)}/SITE.md`;
}

/**
 * Resolve the flow under test, with a review gate: the AI drafts checkpoints
 * from the brief, but the operator confirms them before anyone runs — a wrong
 * flow silently poisons persona generation and every score after it.
 */
async function prepareFlow(
  url: string,
  common: CommonArgs,
  brain: Brain & { ask?(prompt: string): Promise<string> },
): Promise<Flow | null> {
  const existing = loadFlow(url);
  if (existing && !common.plan) return existing;

  let intent = common.flow;
  if (!intent && !common.yes && isInteractive()) {
    intent = (
      await text({
        message: "What flow should they test? (e.g. \"signup through to the dashboard\" — Enter to let prospects wander):",
        fallback: "",
      })
    ).trim();
  }
  if (!intent) return existing; // no flow stated — wander, as before

  process.stdout.write("  \x1b[2mdrafting checkpoints...\x1b[0m");
  let flow = await draftFlow(url, intent, loadBrief(url) ?? "(no brief)", brain);
  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }
  if (!flow) {
    console.log("  (could not draft checkpoints — running without a flow)\n");
    return null;
  }

  // review gate — skipped by --yes and in automation
  while (!common.yes && isInteractive()) {
    console.log(`\n  Flow: ${flow.intent}`);
    flow.checkpoints.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
    const choice = await select({
      message: "Use these checkpoints?",
      choices: [
        { value: "use", label: "use these" },
        { value: "redo", label: "regenerate" },
        { value: "edit", label: "edit the file, then continue", hint: flowPathLabel(url) },
        { value: "none", label: "no flow — let them wander" },
      ],
    });
    if (choice === "use") break;
    if (choice === "none") return null;
    if (choice === "edit") {
      await text({ message: `Edit ${flowPathLabel(url)}, then press Enter:`, fallback: "" });
      flow = loadFlow(url) ?? flow;
      break;
    }
    const redone = await draftFlow(url, intent, loadBrief(url) ?? "(no brief)", brain);
    if (redone) flow = redone;
    else console.log("  (regeneration failed — keeping the previous draft)");
  }

  console.log(`\n  flow: ${flowPathLabel(url)} (${flow.checkpoints.length} checkpoints)\n`);
  return flow;
}

function flowPathLabel(url: string): string {
  return `runs/${siteSlug(url)}/FLOW.md`;
}

/**
 * Make sure this site has its own persona set, generating one if it has none.
 * Returns the ids that were generated, or an empty array.
 */
async function prepareSitePersonas(
  url: string,
  common: CommonArgs,
  brain: Brain & { ask?(prompt: string): Promise<string> },
  flow?: Flow | null,
): Promise<{ id: string; name: string; temperature: string }[]> {
  const outDir = sitePersonasDir(url);
  // only this site's own set — a global personas/ directory is not evidence
  // that this product has been thought about
  const existing = Object.entries(siteOwnPersonas(url)).map(([id, p]) => ({
    id,
    name: p.name,
    temperature: p.temperature,
  }));

  if (existing.length > 0 && !common.plan) return existing;

  let count = 10;
  if (!common.yes && isInteractive()) {
    const answer = await text({
      message: "How many personas should I build for this site? (2-10, Enter for 10, 0 to skip):",
      fallback: "10",
      validate: (v) =>
        /^\d+$/.test(v) && (+v === 0 || (+v >= 2 && +v <= 10))
          ? undefined
          : "give 0 to skip, or a number from 2 to 10",
    });
    count = Number(answer);
    if (count === 0) return existing;
  }

  try {
    const result = await generatePersonas({
      description: icpSeed(url) ?? undefined,
      count,
      brain,
      site: url,
      // the brief instead of a second scrape: it is both cheaper and better
      // context than a raw accessibility dump of the same page
      siteContext: loadBrief(url) ?? undefined,
      flowContext: flow
        ? `${flow.intent}\nCheckpoints: ${flow.checkpoints.join(" -> ")}`
        : undefined,
      outDir,
    });
    console.log(result.graph);
    return result.written.map((p) => ({ id: p.id, name: p.name, temperature: p.temperature }));
  } catch (e) {
    console.error(`  persona generation failed: ${(e as Error).message.slice(0, 160)}`);
    console.log("  falling back to the built-in personas.\n");
    return existing;
  }
}

/**
 * Resolve the run queue.
 *
 * Explicit flags win, as they always did. What changed is what happens with no
 * flags: the site's own generated personas are offered first, and the built-in
 * cold/warm/hot counts are the fallback rather than the default.
 */
async function resolveRunPlan(
  url: string,
  common: CommonArgs,
  generated: { id: string; name: string; temperature: string }[],
): Promise<string[]> {
  if (common.personas?.length) return common.personas.slice(0, MAX_RUNS);
  if (common.runs && common.runs > 0) return randomRunPlan(common.runs, url);

  if (common.yes || !isInteractive()) {
    // unattended: everything built for this site, else one of each built-in
    return generated.length ? generated.slice(0, MAX_RUNS).map((p) => p.id) : ["cold", "warm", "hot"];
  }

  if (generated.length > 0) {
    const queue = await multiselect({
      message: "Which prospects should visit? (one run each)",
      choices: generated.map((p) => ({
        value: p.id,
        label: p.id,
        hint: `${p.name} — ${p.temperature}`,
      })),
    });
    if (queue.length) return queue.slice(0, MAX_RUNS);
    console.log("  none picked — falling back to the built-ins.\n");
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

  // the brief comes first, and comes even when --persona was passed: it is the
  // ICP the persona set is built from, and the prior knowledge warm/hot arrive with
  stageBanner("site", common.stop);
  await prepareSite(url, common, planningBrain);
  const blocked = blockedReason(url);
  if (blocked) {
    console.log(
      `  ⛔ ${siteSlug(url)} is behind a bot wall (${blocked}) — skipping. Delete runs/${siteSlug(url)}/BLOCKED.md or pass --plan to re-check.\n`,
    );
    return [];
  }
  const flow = await prepareFlow(url, common, planningBrain);
  if (!runsThrough("personas", common.stop)) {
    console.log(`  Stopped after the site read. See ${briefPathLabel(url)}\n`);
    return [];
  }

  stageBanner("personas", common.stop);
  const generated = common.personas?.length
    ? []
    : await prepareSitePersonas(url, common, planningBrain, flow);
  if (!runsThrough("visit", common.stop)) {
    console.log(`  Stopped after building personas. See runs/${siteSlug(url)}/personas/\n`);
    return [];
  }

  const personaIds = await resolveRunPlan(url, common, generated);
  const registry = getPersonaRegistry(url);
  for (const pid of personaIds) {
    if (!registry.personas[pid]) {
      console.error(
        `Unknown persona "${pid}". Available: ${Object.keys(registry.personas).join(", ")} (or add YAML files in personas/)`,
      );
      process.exit(1);
    }
  }

  const dirs: string[] = [];
  const mailCfg = mailConfig();
  if (!mailCfg) {
    // with a mailbox the harness forces every typed address to the ephemeral
    // one; without it, whatever the brain invents is what real signup forms get
    console.warn(
      `\n  ⚠ no mailbox configured — personas will invent email addresses and may sign real\n` +
        `    inboxes up to ${siteSlug(url)}. Set CLIENTSIM_IMAP_* (see README) to give each run a\n` +
        `    throwaway address the harness enforces, and to let personas read verification mail.`,
    );
  }

  // Everyone runs at once — the queue (≤ MAX_RUNS) is the concurrency cap.
  // Each session already has its own browser, brain, mailbox and directory;
  // sharing any of those across personas is the bug 646556a fixed.
  const parallel = personaIds.length > 1;
  stageBanner("visit", common.stop);
  console.log(
    `  ${personaIds.length} prospect(s) ${parallel ? "going in together" : "queued"}: ${personaIds.join(", ")} | ${describeRun(common)}`,
  );
  console.log(progressBar(0, personaIds.length, "agents finished") + "\n");

  // dirs are minted before anyone launches: sessionPath's same-second suffix
  // check is exists-then-create, which two concurrent starts would race
  const runs = personaIds.map((pid, i) => {
    const sessionDir = sessionPath(url, pid);
    mkdirSync(`${sessionDir}/shots`, { recursive: true });
    return { pid, sessionDir, n: i + 1 };
  });

  let done = 0;
  const runOne = async ({ pid, sessionDir, n }: (typeof runs)[number]) => {
    const persona: Persona = registry.personas[pid];
    const tag = parallel ? pid : undefined;

    // one provider per agent — an IMAP connection is stateful, and concurrent
    // polls through a shared one interleave on a single socket
    const mail = mailCfg ? new ImapProvider(mailCfg) : undefined;
    let box: Mailbox | undefined;

    // fresh brain per persona — a shared one would carry the previous
    // persona's whole conversation into this one's first impression
    const brain = getBrain(common.brain ?? "claude", {
      model: common.model,
      effort: common.effort,
      allowDir: sessionDir, // so the persona can read its own screenshots
    });

    const driver = new BrowserDriver();
    try {
      // EPHEMERAL MAILBOX: created per persona run, destroyed after
      if (mail) box = await mail.create(pid);
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
          mail: mail && box ? { provider: mail, box } : undefined,
          // cold gets nothing, warm the arrival paragraph, hot also the specifics
          arrival: arrivalFor(url, persona.temperature) ?? undefined,
          timeBudgetMinutes: common.time,
          tag,
        }));
      } catch (e) {
        const detail = (e as Error).message.split("\n")[0];
        console.log(`\n  ${tag ? `[${tag}] ` : ""}session failed: ${detail}`);
        exit = { kind: "guardrail", detail: `Session could not run: ${detail}` };
      }

      // one un-retried call per session: which flow checkpoints did it reach?
      const flowScore = flow && events.length > 0 ? await scoreFlow(flow, events, brain) : null;
      if (flowScore) {
        console.log(
          `  ${tag ? `[${tag}] ` : ""}flow: ${flowScore.filter((c) => c.reached).length}/${flowScore.length} checkpoints reached`,
        );
      }

      writeFileSync(
        `${sessionDir}/report.md`,
        generateReport({ persona, url, brain: describeRun(common).replace(/^brain: /, ""), events, exit, flow: flowScore ?? undefined }),
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
            exit,
            viewport: common.mobile ? "mobile" : "desktop",
            flow: flowScore,
            // claude reports tokens/cost; opencode does not, so the eval also
            // has steps + wall-clock as a model-agnostic efficiency proxy
            usage: (brain as { usage?: unknown }).usage ?? null,
            steps: events.length,
            durationSeconds: journeySeconds(events),
          },
          null,
          2,
        ),
      );
      dirs.push(sessionDir);

      printSessionSummary(exit, events, sessionDir, ++done, personaIds.length);
    } catch (e) {
      // a setup failure (mailbox, browser launch) must not kill the other runs
      console.error(`  ${tag ? `[${tag}] ` : ""}run failed before the session started: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      // before close(), and in finally, so an error mid-session still yields a video
      await driver.saveVideo(`${sessionDir}/video.webm`).catch(() => {});
      await driver.close();
      if (mail && box) {
        try {
          await mail.destroy(box);
          await mail.close?.();
          console.log(`  ${tag ? `[${tag}] ` : ""}🗑 mailbox destroyed`);
        } catch (e) {
          console.log(`  ${tag ? `[${tag}] ` : ""}🗑 mailbox destroy failed: ${(e as Error).message.slice(0, 100)}`);
        }
      }
    }
  };

  if (parallel) await Promise.all(runs.map(runOne));
  else for (const r of runs) await runOne(r);
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
  // running tally — with concurrent agents this is the one honest progress line
  console.log(progressBar(n, total, "agents finished"));
}

/**
 * STAGE 2 — aggregate per site. A funnel that mixed several websites together
 * would be meaningless, so each site gets its own runs/<site>/AGGREGATE.md.
 */
async function report(dirs: string[] | undefined, force = false, byModel = false) {
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

  // per-model funnels alongside the combined one, so a sweep can be read
  // "how did haiku do vs opus" as well as "how did the site do overall"
  if (byModel) {
    for (const [site, siteDirs] of bySite) {
      const groups = new Map<string, string[]>();
      for (const d of siteDirs) {
        const m = modelOf(d) ?? "unknown";
        groups.set(m, [...(groups.get(m) ?? []), d]);
      }
      for (const [model, mdirs] of groups) {
        const out = `runs/${site}/AGGREGATE-${modelSlug(model)}.md`;
        writeFileSync(out, `<!-- model: ${model} -->\n${generateAggregate(mdirs)}`);
        console.log(`  ${site} / ${model}: ${mdirs.length} session(s) → ${resolve(out)}`);
      }
    }
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

/** A session's recorded model, read straight from meta.json. */
function modelOf(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as { model?: string }).model ?? null;
  } catch {
    return null;
  }
}

/** Model id → filename-safe slug (opencode/big-pickle → opencode-big-pickle). */
function modelSlug(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * STANDALONE — one shareable PDF per site (funnel + every expert report).
 * `--pdf` with no args covers every site in runs/; names/URLs scope it.
 */
async function pdf(sites: string[], model?: string) {
  const targets = sites.length
    ? sites.map(normalizeUrl)
    : (existsSync(RUNS_ROOT) ? readdirSync(RUNS_ROOT) : [])
        .filter((s) => !s.startsWith(".") && existsSync(`${RUNS_ROOT}/${s}/AGGREGATE.md`))
        .map((s) => `https://${s}`);

  if (targets.length === 0) {
    console.error("Nothing to render. Run a site first, or pass site names: client-simulator --pdf firecrawl.dev");
    process.exit(1);
  }

  for (const url of targets) {
    // --model scopes the fixes to one brain; default is the best model present
    const { files, model: usedModel } = packetFor(url, model);
    if (files.length === 0) {
      console.log(`  ${siteSlug(url)}: no AGGREGATE.md/FIXES.md yet — skipping (run report/fix first)`);
      continue;
    }
    const out = `${RUNS_ROOT}/${siteSlug(url)}/${siteSlug(url)}-report.pdf`;
    process.stdout.write(`  ${siteSlug(url)}: ${files.length} section(s)${model ? `, ${model}` : ""}...`);
    try {
      await htmlToPdf(packetHtml(url, files, model), out);
      console.log(` ${resolve(out)}`);
    } catch (e) {
      console.log(` failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  console.log("");
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
    // scoped to this session's own site, or a persona generated for it is not
    // in the registry and the panel reviews the run as Skeptical Sam
    const registry = getPersonaRegistry(s.meta.url);
    const persona = registry.personas[s.meta.personaId] ?? PERSONAS.cold;
    if (!registry.personas[s.meta.personaId]) {
      console.log(
        `  ! persona "${s.meta.personaId}" not found — reviewing as ${PERSONAS.cold.name}, which will skew the advice`,
      );
    }
    console.log(
      `\n  Expert panel: ${persona.name} @ ${s.meta.url} (${s.events.length} steps)`,
    );
    console.log(`  Experts (in parallel): ${EXPERTS.map((e) => e.id).join(", ")}`);
    let panelDone = 0;

    const briefText = loadBrief(s.meta.url) ?? undefined;
    // the experts are independent — each its own brain, each returns one
    // section — so they run at once. No spinner: concurrent clearLine races.
    const results = await Promise.all(
      EXPERTS.map(async (expert) => {
        // fresh brain per expert — independent verdicts, not a group conversation
        const expertBrain = getBrain(common.brain ?? "claude", {
          model: common.model,
          effort: common.effort,
          role: "expert",
          allowDir: s.dir,
        });
        const section = await expert
          .run(
            {
              persona,
              url: s.meta.url,
              events: s.events,
              exit: s.meta.exit,
              viewport: (s.meta as any).viewport,
              // the panel used to review a journey with the destination missing
              brief: briefText,
            },
            expertBrain,
          )
          .catch((e) => {
            console.log(`  [${expert.id}] failed: ${(e as Error).message.split("\n")[0]}`);
            return null;
          });
        console.log(
          `  [${expert.id}] ${section ? "done" : "skipped"}  ${progressBar(++panelDone, EXPERTS.length, "experts").trim()}`,
        );
        return section ? `## ${expert.title} — ${expert.id}\n\n${section}` : null;
      }),
    );
    // keep registry order regardless of which finished first
    const sections = results.filter((x): x is string => x !== null);

    if (sections.length === 0) continue;

    const doc = `# Expert Fixes\n\nSession: \`${s.dir}\`\nSite: ${s.meta.url}\nPersona: ${persona.name} (${persona.temperature})\n\n---\n\n${sections.join("\n---\n\n")}\n`;
    writeFileSync(`${s.dir}/FIXES.md`, doc);
    console.log(`  Fixes → ${s.dir}/FIXES.md`);
  }
}

/**
 * Between-stage gate: what just happened, then continue / redo / settings /
 * stop. Silent under --yes and without a TTY — automation must never hang here.
 */
async function stageGate(
  doneMsg: string,
  nextLabel: string,
  common: CommonArgs,
): Promise<"continue" | "redo" | "stop"> {
  if (common.yes || !isInteractive()) return "continue";
  for (;;) {
    const choice = await select({
      message: `${doneMsg}. Next: ${nextLabel}`,
      choices: [
        { value: "continue", label: `continue — ${nextLabel}` },
        { value: "redo", label: "redo the stage that just ran" },
        { value: "settings", label: "change settings first", hint: "brain, model, effort, time, browser window" },
        { value: "stop", label: "stop here" },
      ],
    });
    if (choice !== "settings") return choice as "continue" | "redo" | "stop";
    await changeSettings(common);
  }
}

/** Re-open the run settings mid-pipeline. The next stage picks them up. */
async function changeSettings(common: CommonArgs) {
  // clearing these makes the picker actually ask instead of accepting the old answers
  common.brain = common.model = common.effort = undefined;
  common.brainResolved = false;
  await resolveBrain(common, "Which AI for what runs next?");

  const t = await text({
    message: `Minutes per session (Enter to keep ${common.time ?? 20}):`,
    fallback: "",
  });
  if (/^\d+$/.test(t.trim())) common.time = Math.min(120, Math.max(1, Number(t)));

  common.headless = await select({
    message: "Browser window?",
    choices: [
      { value: common.headless, label: `keep (${common.headless ? "headless" : "visible"})` },
      { value: !common.headless, label: common.headless ? "visible" : "headless" },
    ],
  });
}

/** PIPELINE — visit → report → fix (pipeline always regenerates: it just made new data) */
/**
 * The whole tool for one URL: read -> personas -> visit -> report -> fix,
 * ending wherever `--stop` says. Interactive runs get a gate between stages.
 */
async function all(url: string, common: CommonArgs) {
  let dirs: string[];
  for (;;) {
    dirs = await visit(url, common);
    if (!dirs.length || !runsThrough("report", common.stop)) {
      if (dirs.length) console.log(`\n  Stopped after visit. ${dirs.length} session(s) on disk.\n`);
      return;
    }
    const g = await stageGate(
      `${dirs.length} session(s) on disk`,
      "report — aggregate this site's funnel",
      common,
    );
    if (g === "stop") {
      console.log(`\n  Stopped after visit. ${dirs.length} session(s) on disk.\n`);
      return;
    }
    if (g !== "redo") break;
  }

  for (;;) {
    stageBanner("report", common.stop);
    await report(dirs, true);
    if (!runsThrough("fix", common.stop)) {
      const sites = [...new Set(loadSessions(dirs).map((x) => siteSlug(x.meta.url)))];
      console.log(
        `\n  Stopped after report. See ${sites.map((x) => `runs/${x}/AGGREGATE.md`).join(", ")}.\n`,
      );
      return;
    }
    const g = await stageGate(
      "aggregate written",
      "fix — expert panel over each session",
      common,
    );
    if (g === "stop") {
      const sites = [...new Set(loadSessions(dirs).map((x) => siteSlug(x.meta.url)))];
      console.log(
        `\n  Stopped after report. See ${sites.map((x) => `runs/${x}/AGGREGATE.md`).join(", ")}.\n`,
      );
      return;
    }
    if (g !== "redo") break;
  }

  // common now carries the resolved brain/model/effort — stage 3 reuses it verbatim
  stageBanner("fix", common.stop);
  await fix(dirs, common, true);

  const sites = [...new Set(loadSessions(dirs).map((x) => siteSlug(x.meta.url)))];
  console.log(
    `\n  Done: ${dirs.length} session(s). See ${sites
      .map((x) => `runs/${x}/SITE.md, runs/${x}/AGGREGATE.md`)
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
/** Free-text answer with a hard ceiling — a 4,000-word "goal" is not a goal. */
const limited = (max: number, what: string) => (v: string) => {
  const t = v.trim();
  if (!t) return `${what} cannot be empty`;
  if (t.length > max) return `keep it under ${max} characters (currently ${t.length})`;
  return undefined;
};

/**
 * Build a persona by asking, rather than scaffolding a file to hand-edit.
 *
 * Saves either globally or into one site's set, so a persona written for one
 * product does not turn up on every other site you test.
 */
async function newPersonaInteractive(name: string): Promise<void> {
  heading(`New persona — ${name}`);

  const sites = sitesWithPersonas().map((s) => s.site);
  const knownSites = [...new Set([...sites, ...(existsSync(RUNS_ROOT) ? readdirSync(RUNS_ROOT) : [])])]
    .filter((s) => !s.startsWith("."))
    .sort();

  const scope = await select({
    message: "Where should it live?",
    choices: [
      { value: "", label: "everywhere", hint: "personas/ — offered on every site" },
      ...knownSites.map((s) => ({
        value: s,
        label: `only ${s}`,
        hint: `runs/${s}/personas/`,
      })),
    ],
  });

  const temperature = await select({
    message: "How much do they already know when they arrive?",
    choices: [
      { value: "cold", label: "cold", hint: "never heard of it — gets no site context at all" },
      { value: "warm", label: "warm", hint: "knows what they came looking for" },
      { value: "hot", label: "hot", hint: "already looked up the price and how to sign up" },
    ],
  });

  const goal = await text({
    message: "What did they come to do? (one or two sentences, max 300)",
    validate: limited(300, "the goal"),
  });

  const tech = await select({
    message: "Tech comfort?",
    choices: [
      { value: "medium", label: "medium" },
      { value: "low", label: "low", hint: "put off by code samples and jargon" },
      { value: "high", label: "high" },
    ],
  });

  const patience = await text({
    message: "How many decisions before they give up? (1-50, Enter for 12)",
    fallback: "12",
    validate: (v) =>
      /^\d+$/.test(v.trim()) && +v >= 1 && +v <= 50 ? undefined : "a number from 1 to 50",
  });

  console.log(
    "\n  Traits are the personality lever — short, first-person habits the model copies.",
  );
  const traits: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const t = await text({
      message: `  trait ${i}${i > 2 ? " (Enter to finish)" : ""} (max 120 chars):`,
      fallback: i > 2 ? "" : undefined,
      validate: (v) =>
        i > 2 && !v.trim() ? undefined : limited(120, "a trait")(v),
    });
    if (!t.trim()) break;
    traits.push(t.trim());
  }

  const dir = scope ? resolve(`${RUNS_ROOT}/${scope}/personas`) : PERSONAS_DIR;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/${id}.yaml`;
  if (existsSync(path)) {
    console.error(`\n  ${path} already exists — pick another name.\n`);
    process.exit(1);
  }

  writeFileSync(
    path,
    `# ${name}${scope ? ` — built for ${scope}` : ""}\n` +
      `# Edit freely; delete the file to remove.\n\n` +
      stringifyYaml({
        name,
        temperature,
        goal: goal.trim(),
        tech_comfort: tech,
        patience_steps: Number(patience),
        traits,
      }) +
      "\n",
  );

  console.log(`\n  ✓ ${path}`);
  console.log(
    scope
      ? `  It will be offered automatically when you test ${scope}.\n`
      : `  Use it anywhere:  client-simulator <url> --persona ${id}\n`,
  );
}

function personasCommand(args: string[]) {
  if (args.includes("--new")) {
    const nameIdx = args.indexOf("--new");
    const name = args[nameIdx + 1];
    if (!name || name.startsWith("--")) {
      console.error("Usage: client-simulator --new-persona \"Persona Name\"");
      process.exit(1);
    }
    try {
      const path = newPersonaFile(name);
      console.log(`\n  ✓ created ${path}`);
      console.log(`  Edit it, then use: client-simulator <url> --persona ${path.split("/").pop()?.replace(/\.yaml$/, "")}\n`);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  // grouped by where they live, because a flat list hid site sets entirely and
  // left you wondering where the personas you just generated had gone
  const { errors } = getPersonaRegistry();
  const rows = (personas: Record<string, Persona>) => {
    for (const [id, p] of Object.entries(personas)) {
      // ids and names are both user-supplied; truncate so one long one cannot
      // shunt every other column out of line
      const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).padEnd(n);
      console.log(
        `    ${fit(id, 32)} ${fit(p.name, 34)} ${p.temperature.padEnd(6)} ${String(p.patience_steps).padStart(2)} steps`,
      );
    }
  };

  console.log(`\n  Personas  (use with --persona <id>)`);

  console.log(`\n  Built in`);
  rows(PERSONAS);

  const { personas: global } = loadCustomPersonas();
  if (Object.keys(global).length > 0) {
    console.log(`\n  Yours — personas/  (available on every site)`);
    rows(global);
  }

  for (const { site, dir, personas } of sitesWithPersonas()) {
    console.log(`\n  Built for ${site} — ${dir}/`);
    rows(personas);
  }

  if (errors.length > 0) {
    console.log(`\n  ⚠ invalid persona files (not loaded):`);
    for (const e of errors) console.log(`    ${e.file}: ${e.error}`);
  }
  console.log(
    `\n  New one:  client-simulator --new-persona "My Persona"   (asks a few questions)` +
      `\n  Or let it build a set for a site:  client-simulator <url> --stop personas\n`,
  );
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
      { value: "test", label: "test a site", hint: "read it, build prospects, send them, report" },
      { value: "report", label: "report on past runs", hint: "aggregate sessions into a funnel" },
      { value: "fix", label: "review a past session", hint: "expert panel -> FIXES.md" },
      { value: "personas", label: "personas", hint: "list every persona you have" },
      { value: "doctor", label: "doctor", hint: "verify your environment" },
    ],
  });

  const common: CommonArgs = { headless: false, mobile: false };

  switch (action) {
    case "test": {
      const url = await askUrl();
      const stop = await select<Stage | "">({
        message: "How far should it go?",
        choices: [
          { value: "", label: "all the way", hint: "read -> personas -> visit -> report -> panel" },
          { value: "report", label: "stop after the report", hint: "no expert panel" },
          { value: "visit", label: "stop after the runs", hint: "no report, no panel" },
          { value: "personas", label: "just read it and build prospects", hint: "nobody visits yet" },
        ],
      });
      if (stop) common.stop = stop;
      await all(url, common);
      break;
    }
    case "report":
      await report(undefined, false);
      break;
    case "fix": {
      const dirs = findSessionDirs();
      if (dirs.length === 0) {
        console.error("\n  No sessions to review yet — test a site first.\n");
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
    case "personas":
      personasCommand([]);
      break;
    case "doctor": {
      const choice = await resolveBrainChoice({}, "Which AI should I health-check?", {
        requireInstalled: false,
      });
      if (!(await runDoctor(choice.brain, true))) process.exitCode = 1;
      break;
    }
  }
}

const VALUE_FLAGS = new Set([
  "--persona",
  "--personas",
  "--brain",
  "--runs",
  "--time",
  "--flow",
  "--model",
  "--effort",
  "--stop",
  "--new-persona",
  "--from",
  "--site",
  "--count",
]);

/** Everything that is not a flag or a flag's value. */
function positionalsOf(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("-")) {
      if (VALUE_FLAGS.has(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

/** Subcommands from before the single-command surface. Still dispatch; not in --help. */
const LEGACY = new Set(["visit", "report", "fix", "all", "doctor", "personas", "mailtest"]);

async function main() {
  loadDotEnv();
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    await wizard();
    return;
  }
  if (argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  // legacy subcommand form, kept so nothing anyone typed before breaks
  if (LEGACY.has(argv[0])) {
    await legacy(argv[0], argv.slice(1));
    return;
  }

  const common = parseCommon(argv);
  const force = argv.includes("--force");
  const positionals = positionalsOf(argv);

  // standalone modes — each ends the run
  if (argv.includes("--doctor")) {
    const choice = await resolveBrainChoice(
      { brain: common.brain, model: common.model, effort: common.effort },
      "Which AI should I health-check?",
      { requireInstalled: false },
    );
    if (!(await runDoctor(choice.brain, force))) process.exitCode = 1;
    return;
  }
  if (argv.includes("--mailtest")) return void (await mailtest());
  if (argv.includes("--list-personas")) return personasCommand([]);
  if (argv.includes("--new-persona")) {
    const name = flagValue(argv, "--new-persona");
    if (!name) {
      console.error('--new-persona needs a name, e.g. --new-persona "Budget Bianca"');
      process.exit(1);
    }
    return void (isInteractive()
      ? await newPersonaInteractive(name)
      : personasCommand(["--new", name]));
  }
  if (argv.includes("--fix")) {
    const dirs = positionals.length ? positionals : findSessionDirs();
    if (!dirs.length) {
      console.error("\n  No sessions to review yet — run a visit first.\n");
      process.exit(1);
    }
    return void (await fix(dirs, common, force));
  }
  if (argv.includes("--report")) {
    return void (await report(positionals.length ? positionals : undefined, force, argv.includes("--by-model")));
  }
  if (argv.includes("--pdf")) {
    return void (await pdf(positionals));
  }

  const url = positionals[0];
  if (!url) {
    console.error("Give me a URL: client-simulator <url>. See --help.");
    process.exit(1);
  }
  await all(normalizeUrl(url), common);
}

function normalizeUrl(raw: string): string {
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

/** Pre-single-command dispatch. Undocumented, unchanged in behaviour. */
async function legacy(command: string, rest: string[]) {
  const common = parseCommon(rest);
  const force = rest.includes("--force");
  const positionals = positionalsOf(rest);
  const needUrl = (usage: string) => {
    if (!positionals[0]) {
      console.error(usage);
      process.exit(1);
    }
    return normalizeUrl(positionals[0]);
  };

  switch (command) {
    case "visit":
      await visit(needUrl("Usage: client-simulator <url> [--persona cold,warm,hot]"), common);
      break;
    case "all":
      await all(needUrl("Usage: client-simulator <url> [--persona cold,warm,hot]"), common);
      break;
    case "report":
      await report(positionals.length ? positionals : undefined, force);
      break;
    case "fix":
      await fix(positionals, common, force);
      break;
    case "mailtest":
      await mailtest();
      break;
    case "doctor": {
      const choice = await resolveBrainChoice(
        { brain: common.brain, model: common.model, effort: common.effort },
        "Which AI should I health-check?",
        { requireInstalled: false },
      );
      if (!(await runDoctor(choice.brain, force))) process.exitCode = 1;
      break;
    }
    case "personas":
      if (rest[0] === "generate") await personasGenerate(rest.slice(1));
      else personasCommand(rest);
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
