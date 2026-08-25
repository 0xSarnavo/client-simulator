import { makeCliBrain } from "./cli-brain.js";

export function createOpencodeBrain() {
  return makeCliBrain({
    name: "opencode",
    // no -s: stateless per call, same as the other adapters — journey memory
    // comes from the tiered history the prompt builder renders
    command: "opencode",
    args: (prompt, { model }) => [
      "run",
      "--print-logs",
      ...(model ? ["--model", model] : []),
      // opencode has no effort flag; reasoning depth follows the model config
      prompt,
    ],
    extractText: (stdout) => stdout,
    timeoutMs: 300_000,
  });
}
