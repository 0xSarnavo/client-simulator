import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCliBrain } from "./cli-brain.js";
import type { BrainRole } from "../roles.js";

/**
 * Personas ingest hostile page/email content, so their tool surface is denied
 * outright via a config file (verified: opencode honours OPENCODE_CONFIG
 * permission denies in non-interactive `run`). Experts keep the default
 * profile — their prompts legitimately invite shell and web access.
 */
const PERSONA_DENY_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  permission: { edit: "deny", bash: "deny", webfetch: "deny" },
};

let denyConfigPath: string | null = null;

function writePersonaDenyConfig(): string {
  // one shared config per process (unique 0700 dir: another local user must
  // not be able to pre-plant this file)
  if (!denyConfigPath) {
    const dir = mkdtempSync(join(tmpdir(), "clientsim-oc-"));
    denyConfigPath = join(dir, "persona-permissions.json");
    writeFileSync(denyConfigPath, JSON.stringify(PERSONA_DENY_CONFIG));
  }
  return denyConfigPath;
}

export function createOpencodeBrain(role: BrainRole = "persona") {
  return makeCliBrain({
    name: "opencode",
    // no -s: stateless per call, same as the other adapters — journey memory
    // comes from the tiered history the prompt builder renders
    command: "opencode",
    // reads outside the CLI's cwd are permission-rejected in non-interactive
    // `run` (there is no --add-dir equivalent), so prompts must never point
    // this brain at screenshot files — a rejected read stalls some models
    readsFiles: false,
    args: (prompt, { model }) => [
      "run",
      "--print-logs",
      ...(model ? ["--model", model] : []),
      // opencode has no effort flag; reasoning depth follows the model config
      prompt,
    ],
    // deny config is only honoured through the environment, not a CLI flag
    ...(role === "persona" ? { env: { OPENCODE_CONFIG: writePersonaDenyConfig() } } : {}),
    extractText: (stdout) => stdout,
    timeoutMs: 300_000,
  });
}
