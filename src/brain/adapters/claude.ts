import { makeCliBrain } from "./cli-brain.js";
import type { BrainRole } from "../roles.js";

interface ClaudeJsonOutput {
  result?: string;
}

/**
 * Tools cost ~5k tokens of schema on every call and widen what the model can do.
 *
 * A persona keeps only Read, so it can look at its own screenshot but cannot
 * shell out, fetch the URL directly, or read the project it is running against.
 *
 * Experts read a transcript quoting the site under review, so their input is
 * attacker-influenced too — they lose the shell for the same reason. WebFetch
 * stays: their prompts need the page's raw text, and fetching a URL is the
 * narrow tool for that, where Bash was a general-purpose one.
 */
const PERSONA_DISALLOWED = [
  "Bash", "BashOutput", "KillShell", "Write", "Edit", "NotebookEdit",
  "WebFetch", "WebSearch", "Task", "Glob", "Grep", "TodoWrite", "SlashCommand",
];

const EXPERT_DISALLOWED = [
  "Bash", "BashOutput", "KillShell",
  "Write", "Edit", "NotebookEdit", "Task", "TodoWrite", "SlashCommand",
];

export function createClaudeBrain(role: BrainRole = "persona") {
  const disallowed = role === "expert" ? EXPERT_DISALLOWED : PERSONA_DISALLOWED;
  return makeCliBrain({
    name: "claude",
    // --add-dir opts the session dir in, so Read reaches the screenshots
    readsFiles: true,
    command: "claude",
    // no --resume: each call is self-contained and the prompt carries the
    // journey, so context cannot grow without bound across a run
    args: (prompt, { model, effort, allowDir }) => [
      "-p",
      prompt,
      ...(model ? ["--model", model] : []),
      ...(effort ? ["--effort", effort] : []),
      // the CLI runs outside the project, so the session dir must be opted in
      // explicitly or Read cannot reach the screenshots
      ...(allowDir ? ["--add-dir", allowDir] : []),
      "--disallowed-tools",
      disallowed.join(","),
      "--output-format",
      "json",
    ],
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
}
