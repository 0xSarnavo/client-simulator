import type { Brain, BrainContext, Decision } from "../../types.js";
import { DecisionSchema, VerdictSchema } from "../../types.js";

const TIMEOUT_MS = 180_000;

export interface CliBrainOptions {
  name: string;
  command: string;
  /** Build CLI args. Receives the prompt and the persistent session id (if established). */
  args: (prompt: string, sessionId?: string) => string[];
  /** Extract the assistant text from the CLI's raw stdout */
  extractText: (stdout: string) => string;
  /** Parse a persistent session id from the first call's output (stdout+stderr) */
  parseSessionId?: (output: string) => string | undefined;
  /** Pre-generate a session id to pass from the very first call */
  initSessionId?: () => string;
  timeoutMs?: number;
}

export function makeCliBrain(opts: CliBrainOptions): Brain & { ask(prompt: string): Promise<string> } {
  let sessionId = opts.initSessionId?.();

  async function runOnce(prompt: string): Promise<string> {
    const result = await import("execa").then(({ execa }) =>
      execa(opts.command, opts.args(prompt, sessionId), {
        stdin: "ignore",
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
        reject: false,
      }),
    );
    if (result.failed && !result.stdout) {
      throw new Error(
        `${opts.name} CLI failed: ${result.stderr || result.shortMessage}`,
      );
    }
    if (!sessionId && opts.parseSessionId) {
      sessionId =
        opts.parseSessionId(result.stdout + "\n" + result.stderr) ??
        sessionId;
    }
    return opts.extractText(result.stdout);
  }

  return {
    name: opts.name,

    /** Free-form question inside the same persistent session. Used for verification. */
    async ask(prompt: string): Promise<string> {
      return runOnce(prompt);
    },

    async decide(ctx: BrainContext): Promise<Decision> {
      const { buildPrompt } = await import("../prompt.js");
      const basePrompt = buildPrompt(ctx);
      let lastError = "";

      for (let attempt = 0; attempt < 2; attempt++) {
        const prompt =
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANT: Your previous reply was not valid JSON (${lastError}). Reply with ONLY the JSON object, nothing else.`;

        const text = await runOnce(prompt);
        const parsed = tryParseDecision(text);
        if ("decision" in parsed) return parsed.decision;
        lastError = parsed.error;
      }

      throw new Error(
        `${opts.name} failed to produce a valid decision after retry: ${lastError}`,
      );
    },
  };
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
