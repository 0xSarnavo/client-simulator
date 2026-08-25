import { makeCliBrain } from "./cli-brain.js";

/**
 * ChatGPT subscription brain via OpenAI's Codex CLI (npm i -g @openai/codex, then `codex login`).
 * Stateless per call — journey memory comes from the tiered history in the prompt.
 */
export const codexBrain = makeCliBrain({
  name: "codex",
  command: "codex",
  args: (prompt, _sessionId, model, effort) => [
    "exec",
    "--skip-git-repo-check",
    ...(model ? ["-m", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    prompt,
  ],
  extractText: (stdout) => stdout,
  timeoutMs: 300_000,
});
