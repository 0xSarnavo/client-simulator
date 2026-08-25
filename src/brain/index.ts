import type { Brain } from "../types.js";
import { claudeBrain } from "./adapters/claude.js";
import { opencodeBrain } from "./adapters/opencode.js";
import { codexBrain } from "./adapters/codex.js";

export function getBrain(name: string, model?: string): Brain {
  const brains: Record<string, Brain> = {
    claude: claudeBrain,
    opencode: opencodeBrain,
    codex: codexBrain,
  };
  const brain = brains[name];
  if (!brain) {
    throw new Error(`Unknown brain "${name}". Available: ${Object.keys(brains).join(", ")}`);
  }
  if (model) (brain as { model?: string }).model = model;
  return brain;
}
