import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execa } from "execa";

const STATE_FILE = ".clientsim-state.json";
const STATE_MAX_AGE_MS = 7 * 24 * 3600_000; // re-verify weekly

interface DoctorResult {
  name: string;
  ok: boolean;
  detail: string;
  live: boolean;
}

interface StateFile {
  lastCheck: string;
  results: DoctorResult[];
}

function loadState(): StateFile | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function stateIsFresh(state: StateFile): boolean {
  return (
    state.results.length > 0 &&
    Date.now() - new Date(state.lastCheck).getTime() < STATE_MAX_AGE_MS &&
    state.results.every((r) => r.ok)
  );
}

function saveState(results: DoctorResult[]) {
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ lastCheck: new Date().toISOString(), results }, null, 2),
  );
}

async function checkNode(): Promise<DoctorResult> {
  const [major] = process.versions.node.split(".").map(Number);
  return {
    name: "Node.js >= 20",
    ok: major >= 20,
    detail: `v${process.versions.node}`,
    live: false,
  };
}

async function checkChromium(): Promise<DoctorResult> {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return {
      name: "Playwright chromium",
      ok: true,
      detail: "launches OK",
      live: false,
    };
  } catch (e) {
    return {
      name: "Playwright chromium",
      ok: false,
      detail: `${(e as Error).message.split("\n")[0]} — run: npx playwright install chromium`,
      live: false,
    };
  }
}

async function checkCli(cmd: string, versionFlag = "--version"): Promise<DoctorResult> {
  try {
    const r = await execa(cmd, [versionFlag], { timeout: 15_000, reject: false });
    const v = (r.stdout || "").split("\n")[0].slice(0, 40);
    return { name: `${cmd} CLI`, ok: !r.failed, detail: v || "installed", live: false };
  } catch {
    return {
      name: `${cmd} CLI`,
      ok: false,
      detail: "not found in PATH",
      live: false,
    };
  }
}

/** Live brain test: one tiny real call through the adapter path */
async function checkBrainLive(brainName: string): Promise<DoctorResult> {
  try {
    const { getBrain } = await import("./brain/index.js");
    const brain = getBrain(brainName);
    if (!brain.ask) {
      return { name: `brain ${brainName}`, ok: false, detail: "no ask()", live: true };
    }
    const reply = await brain.ask('Reply with exactly: ok');
    const ok = reply.toLowerCase().includes("ok");
    return {
      name: `brain ${brainName} (live call)`,
      ok,
      detail: ok ? "responded" : `unexpected reply: ${reply.slice(0, 40)}`,
      live: true,
    };
  } catch (e) {
    return {
      name: `brain ${brainName} (live call)`,
      ok: false,
      detail: (e as Error).message.slice(0, 80),
      live: true,
    };
  }
}

/** Live mail test: create + destroy an ephemeral mailbox */
async function checkMailLive(): Promise<DoctorResult> {
  const env = process.env;
  if (!env.CLIENTSIM_IMAP_HOST || !env.CLIENTSIM_IMAP_USER || !env.CLIENTSIM_IMAP_PASS || !env.CLIENTSIM_MAIL_DOMAIN) {
    return {
      name: "mailbox (live)",
      ok: true, // optional feature — absence is fine
      detail: "not configured (optional — see README for OTP signups)",
      live: true,
    };
  }
  try {
    const { ImapProvider } = await import("./mail/imap.js");
    const p = new ImapProvider({
      host: env.CLIENTSIM_IMAP_HOST,
      user: env.CLIENTSIM_IMAP_USER,
      pass: env.CLIENTSIM_IMAP_PASS,
      domain: env.CLIENTSIM_MAIL_DOMAIN,
      tls: env.CLIENTSIM_IMAP_TLS !== "false",
      port: env.CLIENTSIM_IMAP_PORT ? Number(env.CLIENTSIM_IMAP_PORT) : undefined,
    });
    const box = await p.create("doctortest");
    await p.destroy(box);
    await p.close();
    return { name: "mailbox (live)", ok: true, detail: `created+destroyed ${box.address}`, live: true };
  } catch (e) {
    return {
      name: "mailbox (live)",
      ok: false,
      detail: (e as Error).message.slice(0, 80),
      live: true,
    };
  }
}

function printQuickStart() {
  console.log(`
  ${"─".repeat(58)}
  Ready. Common commands:

  client-sim visit <url>                      interactive: pick persona counts
  client-sim visit <url> --persona cold       single persona
  client-sim visit <url> --persona cold,warm,hot --brain opencode
  client-sim report                           aggregate all sessions
  client-sim fix runs/<dir>                   expert panel -> FIXES.md
  client-sim all <url>                        visit -> report -> fix

  Brains: --brain claude (default) | --brain opencode
  Full guide: AGENTS.md
  ${"─".repeat(58)}
`);
}

export async function runDoctor(brainName = "claude", force = false): Promise<boolean> {
  const state = loadState();

  if (!force && state && stateIsFresh(state)) {
    console.log(
      `  ✓ environment already verified ${state.lastCheck.slice(0, 10)} (skipping re-checks, --force to redo)`,
    );
    return true;
  }

  console.log(`\n  checking your setup...`);

  const results: DoctorResult[] = [];
  results.push(await checkNode());
  results.push(await checkChromium());

  const claude = await checkCli("claude");
  const opencode = await checkCli("opencode");
  results.push(claude, opencode);

  if (!claude.ok && !opencode.ok) {
    console.error(`\n  ✗ No AI CLI found. Install Claude Code or opencode first.`);
    results.forEach((r) =>
      console.log(`    ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`),
    );
    process.exit(1);
  }

  // live checks — use the brain the user actually has
  const preferred = claude.ok ? "claude" : "opencode";
  if (preferred !== brainName) brainName = preferred;

  results.push(await checkBrainLive(brainName));
  results.push(await checkMailLive());

  let allOk = true;
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);
    if (!r.ok) allOk = false;
  }

  if (allOk) {
    saveState(results);
    printQuickStart();
  } else {
    console.error(`\n  ✗ Fix the ✗ items above, then run: client-sim doctor --force\n`);
  }
  return allOk;
}

export function doctorStateExists(): boolean {
  return existsSync(STATE_FILE);
}
