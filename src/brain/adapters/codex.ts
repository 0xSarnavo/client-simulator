import { makeCliBrain } from "./cli-brain.js";
import type { BrainRole } from "../roles.js";

/**
 * ChatGPT subscription brain via OpenAI's Codex CLI (npm i -g @openai/codex, then `codex login`).
 * Stateless per call — journey memory comes from the tiered history in the prompt.
 *
 * Personas ingest hostile page/email content, so they run under the read-only
 * sandbox (no writes outside it, matching the claude persona's tool policy).
 * Experts keep the CLI default so their prompts can shell out and curl.
 */
export function createCodexBrain(role: BrainRole = "persona") {
  return makeCliBrain({
    name: "codex",
    command: "codex",
    args: (prompt, { model, effort }) => [
      "exec",
      "--skip-git-repo-check",
      ...(role === "persona" ? ["--sandbox", "read-only"] : []),
      ...(model ? ["-m", model] : []),
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      prompt,
    ],
    extractText: (stdout) => stdout,
    timeoutMs: 300_000,
  });
}
