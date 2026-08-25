/**
 * Interactive brain/model/effort selection.
 *
 * Any value supplied as a CLI flag is respected and never re-asked; only the
 * gaps get a prompt. With no TTY every gap falls back to a sane default so
 * automation behaves exactly as it did before the picker existed.
 */
import {
  BRAIN_SPECS,
  describeBrain,
  detectBrains,
  listEfforts,
  listModels,
} from "./catalog.js";
import { confirmed, isInteractive, select, text, type Choice } from "../ui/prompt.js";

export interface BrainChoice {
  brain: string;
  model?: string;
  effort?: string;
}

const DEFAULT_BRAIN = "claude";
const USE_DEFAULT = " default";
const USE_CUSTOM = " custom";

/** Transient status line while we shell out to the CLIs. */
async function withStatus<T>(message: string, work: () => Promise<T>): Promise<T> {
  if (!isInteractive()) return work();
  process.stdout.write(`  \x1b[2m${message}\x1b[0m`);
  try {
    return await work();
  } finally {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
  }
}

async function pickModel(brainId: string): Promise<string | undefined> {
  const models = await withStatus(`asking ${brainId} which models it can run...`, () =>
    listModels(brainId),
  );

  const choices: Choice<string>[] = [
    { value: USE_DEFAULT, label: "default", hint: `whatever ${brainId} is already set to` },
    ...models.map((m) => ({ value: m, label: m })),
    { value: USE_CUSTOM, label: "custom...", hint: "type a model id" },
  ];

  const picked = await select({ message: "Model?", choices });
  if (picked === USE_DEFAULT) {
    confirmed("model", `${brainId} default`);
    return undefined;
  }
  if (picked === USE_CUSTOM) {
    const typed = await text({ message: "Model id:", fallback: "" });
    if (!typed) {
      confirmed("model", `${brainId} default`);
      return undefined;
    }
    confirmed("model", typed);
    return typed;
  }
  confirmed("model", picked);
  return picked;
}

async function pickEffort(brainId: string): Promise<string | undefined> {
  const efforts = await withStatus(`checking ${brainId} reasoning levels...`, () =>
    listEfforts(brainId),
  );
  if (efforts.length === 0) return undefined; // brain has no effort knob — nothing to ask

  const choices: Choice<string>[] = [
    { value: USE_DEFAULT, label: "default", hint: `whatever ${brainId} is already set to` },
    ...efforts.map((e) => ({ value: e, label: e })),
  ];

  const picked = await select({ message: "Reasoning effort?", choices });
  if (picked === USE_DEFAULT) {
    confirmed("effort", `${brainId} default`);
    return undefined;
  }
  confirmed("effort", picked);
  return picked;
}

/**
 * Resolve brain + model + effort, prompting only for what the flags left open.
 * `purpose` is the question shown above the brain menu.
 */
export async function resolveBrainChoice(
  given: { brain?: string; model?: string; effort?: string },
  purpose = "Which AI plays the client?",
): Promise<BrainChoice> {
  if (!isInteractive()) {
    return { brain: given.brain ?? DEFAULT_BRAIN, model: given.model, effort: given.effort };
  }

  let brain = given.brain;
  if (!brain) {
    const available = await withStatus("detecting installed AI CLIs...", detectBrains);
    if (!available.some((a) => a.installed)) {
      throw new Error(
        "No AI CLI found in PATH. Install Claude Code, opencode, or Codex, then re-run.",
      );
    }

    const choices: Choice<string>[] = available.map((a) => ({
      value: a.spec.id,
      label: a.spec.label,
      hint: `${describeBrain(a.spec.id).padEnd(16)} ✓ ${a.detail}`,
      disabled: a.installed
        ? undefined
        : `${describeBrain(a.spec.id).padEnd(16)} ✗ not installed`,
    }));

    const preferredIndex = choices.findIndex((c) => c.value === DEFAULT_BRAIN && !c.disabled);
    brain = await select({ message: purpose, choices, initial: Math.max(preferredIndex, 0) });
    const detail = available.find((a) => a.spec.id === brain)?.detail;
    confirmed("brain", brain, detail);
  }

  if (!BRAIN_SPECS.some((s) => s.id === brain)) {
    throw new Error(
      `Unknown brain "${brain}". Available: ${BRAIN_SPECS.map((s) => s.id).join(", ")}`,
    );
  }

  const model = given.model ?? (await pickModel(brain));
  const effort = given.effort ?? (await pickEffort(brain));
  return { brain, model, effort };
}
