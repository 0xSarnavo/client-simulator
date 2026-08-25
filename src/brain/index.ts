import type { Brain } from "../types.js";
import { claudeBrain } from "./adapters/claude.js";
import { opencodeBrain } from "./adapters/opencode.js";
import { codexBrain } from "./adapters/codex.js";

export function getBrain(name: string): Brain {
  switch (name) {
    case "claude":
      return claudeBrain;
    case "opencode":
      return opencodeBrain;
    case "codex":
      return codexBrain;
    default:
      throw new Error(
        `Unknown brain "${name}". Available: claude, opencode, codex`,
      );
  }
}
