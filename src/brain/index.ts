import type { Brain } from "../types.js";
import type { BrainRole } from "./roles.js";
import { createClaudeBrain } from "./adapters/claude.js";
import { createOpencodeBrain } from "./adapters/opencode.js";
import { createCodexBrain } from "./adapters/codex.js";

/**
 * Brains are built per call, never shared.
 *
 * Each adapter keeps a persistent CLI session (claude --resume, opencode -s) in
 * its closure, so a shared instance would let one persona's conversation bleed
 * into the next one's. Every session — each persona run, each expert — gets its
 * own brain and therefore its own clean context.
 */
const FACTORIES: Record<string, (role: BrainRole) => Brain> = {
  claude: createClaudeBrain,
  opencode: createOpencodeBrain,
  codex: createCodexBrain,
};

export interface BrainOptions {
  model?: string;
  effort?: string;
  /** Decides the tool policy — see adapters/claude.ts */
  role?: BrainRole;
  /** Directory the CLI may read despite running outside the project (screenshots) */
  allowDir?: string;
}

export function getBrain(name: string, opts: BrainOptions = {}): Brain {
  const make = FACTORIES[name];
  if (!make) {
    throw new Error(`Unknown brain "${name}". Available: ${Object.keys(FACTORIES).join(", ")}`);
  }
  const brain = make(opts.role ?? "persona");
  if (opts.model) (brain as { model?: string }).model = opts.model;
  if (opts.effort) (brain as { effort?: string }).effort = opts.effort;
  if (opts.allowDir) (brain as { allowDir?: string }).allowDir = opts.allowDir;
  return brain;
}
