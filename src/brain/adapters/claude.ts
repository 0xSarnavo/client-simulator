import { makeCliBrain } from "./cli-brain.js";

interface ClaudeJsonOutput {
  result?: string;
}

export const claudeBrain = makeCliBrain({
  name: "claude",
  command: "claude",
  args: (prompt, sessionId) => [
    "-p",
    prompt,
    "--output-format",
    "json",
    ...(sessionId ? ["--resume", sessionId] : []),
  ],
  // claude echoes its session_id in every JSON response — resume it next call
  parseSessionId: (output) =>
    output.match(/"session_id"\s*:\s*"([^"]+)"/)?.[1],
  extractText: (stdout) => {
    try {
      const parsed = JSON.parse(stdout) as ClaudeJsonOutput;
      if (parsed.result) return parsed.result;
    } catch {
      // fall through to raw stdout
    }
    return stdout;
  },
});
