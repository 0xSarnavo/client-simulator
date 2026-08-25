import { makeCliBrain } from "./cli-brain.js";

export const opencodeBrain = makeCliBrain({
  name: "opencode",
  command: "opencode",
  args: (prompt, sessionId, model) => [
    "run",
    "--print-logs",
    ...(sessionId ? ["-s", sessionId] : []),
    ...(model ? ["--model", model] : []),
    // opencode has no effort flag; reasoning depth follows the model config
    prompt,
  ],
  parseSessionId: (output) => output.match(/\bcreated id=(ses_\w+)/)?.[1],
  extractText: (stdout) => stdout,
  timeoutMs: 300_000,
});
