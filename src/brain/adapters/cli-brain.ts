import { tmpdir } from "node:os";
import type { Brain, BrainContext, Decision } from "../../types.js";
import { DecisionSchema, VerdictSchema } from "../../types.js";

const TIMEOUT_MS = 180_000;
/** Attempts per decision. Each attempt is its own CLI call, so this bounds cost. */
export const MAX_DECIDE_ATTEMPTS = 3;
/** Backoff after a failed CLI call (rate limit, timeout) — not after a bad reply. */
const CALL_RETRY_BACKOFF_MS = 20_000;

/**
 * Allowlisted environment for spawned brain CLIs. Everything else — including
 * CLIENTSIM_* secrets like the IMAP password — stays in this process and out
 * of every subprocess. Proxy/TLS vars are kept so corporate networks work.
 */
const SPAWN_ENV_ALLOWLIST = [
  "PATH", "HOME", "SHELL", "USER", "LOGNAME",
  "TMPDIR", "TEMP", "TMP",
  "LANG", "LC_ALL", "TERM",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "SSL_CERT_FILE", "SSL_CERT_DIR",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  // brain CLI auth/config/endpoints — named here so they stay opt-in while
  // unknown vars (incl. CLIENTSIM_* secrets) never blanket-inherit
  "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME",
];

export function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SPAWN_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface CliBrainOptions {
  name: string;
  command: string;
  /** Build CLI args from the prompt plus per-call overrides. */
  args: (prompt: string, o: CliCallOptions) => string[];
  /** Extract the assistant text from the CLI's raw stdout */
  extractText: (stdout: string) => string;
  timeoutMs?: number;
  /** Model override passed to the CLI (e.g. "opus", "gpt-5.2") */
  model?: string;
  /** Reasoning effort override (low|medium|high) where the CLI supports it */
  effort?: string;
  /** Directory outside the working dir the CLI may read (session screenshots) */
  allowDir?: string;
  /** Whether persona prompts may point this brain at screenshot files */
  readsFiles?: boolean;
  /**
   * Extra environment for this brain (e.g. opencode's OPENCODE_CONFIG).
   * Merged over a sanitized allowlist — children never inherit the full
   * parent env, so secrets like CLIENTSIM_IMAP_PASS stay in this process.
   */
  env?: Record<string, string>;
}

export interface CliCallOptions {
  model?: string;
  effort?: string;
  allowDir?: string;
}

export function makeCliBrain(opts: CliBrainOptions): Brain & {
  ask(prompt: string): Promise<string>;
  model?: string;
} {
  const self = {
    name: opts.name,
    model: opts.model,
    effort: opts.effort,
    allowDir: opts.allowDir,
    readsFiles: opts.readsFiles ?? false,
    /** Free-form question. Used for verification and by the expert panel. */
    async ask(prompt: string): Promise<string> {
      return runOnce(prompt);
    },
    async decide(ctx: BrainContext): Promise<Decision> {
      const { buildPrompt, buildRepairPrompt } = await import("../prompt.js");
      const basePrompt = buildPrompt(ctx);
      let lastError = "";
      let lastReply = "";

      for (let attempt = 0; attempt < MAX_DECIDE_ATTEMPTS; attempt++) {
        // a malformed reply only needs reformatting, so resend the reply rather
        // than the whole step prompt — the page snapshot dominates its size
        const prompt =
          attempt > 0 && lastReply
            ? buildRepairPrompt(lastReply, lastError)
            : basePrompt;

        let text: string;
        try {
          text = await runOnce(prompt);
        } catch (e) {
          // the call itself failed — likely transient, so back off before retrying
          lastError = (e as Error).message;
          lastReply = "";
          if (attempt < MAX_DECIDE_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, CALL_RETRY_BACKOFF_MS * (attempt + 1)));
          }
          continue;
        }

        const parsed = tryParseDecision(text);
        if ("decision" in parsed) return parsed.decision;
        lastError = parsed.error;
        lastReply = text;
      }

      throw new Error(
        `${opts.name} failed to produce a valid decision after ${MAX_DECIDE_ATTEMPTS} attempts: ${lastError}`,
      );
    },
  };

  async function runOnce(prompt: string): Promise<string> {
    const result = await import("execa").then(({ execa }) =>
      execa(opts.command, opts.args(prompt, { model: self.model, effort: self.effort, allowDir: self.allowDir }), {
        stdin: "ignore",
        // run outside the project so the CLI does not load this repo's own
        // AGENTS.md/CLAUDE.md into a persona that is meant to know nothing
        cwd: tmpdir(),
        // extendEnv:false — execa merges `env` over the full parent env by
        // default, which would silently defeat the allowlist below
        extendEnv: false,
        env: { ...spawnEnv(), ...(opts.env ?? {}) },
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
        reject: false,
      }),
    );
    if (result.failed && !result.stdout) {
      throw new Error(
        `${opts.name} CLI failed: ${result.stderr || result.shortMessage}`,
      );
    }

    return opts.extractText(result.stdout);
  }

  return self;
}

function tryParseDecision(
  text: string,
): { decision: Decision } | { error: string } {
  const jsonStr = extractJson(text);
  if (!jsonStr) return { error: "no JSON object found in reply" };

  try {
    const parsed = JSON.parse(jsonStr);
    const res = DecisionSchema.safeParse(parsed);
    if (res.success) return { decision: res.data };
    return {
      error: `schema validation failed: ${res.error.issues
        .slice(0, 3)
        .map((i: { path: (string | number)[]; message: string }) =>
          `${i.path.join(".")}: ${i.message}`,
        )
        .join("; ")}`,
    };
  } catch (e) {
    return { error: `JSON parse error: ${(e as Error).message}` };
  }
}

export function parseVerdict(text: string): { achieved: boolean; note: string } | null {
  const jsonStr = extractJson(text);
  if (!jsonStr) return null;
  try {
    const res = VerdictSchema.safeParse(JSON.parse(jsonStr));
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

/** Extract the first balanced JSON object from arbitrary text. */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
