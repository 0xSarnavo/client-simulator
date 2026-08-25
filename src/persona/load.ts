import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Persona } from "../types.js";
import { PERSONAS } from "./presets.js";

export const PERSONAS_DIR = resolve("personas");

/** Schema for persona YAML files — required: name, temperature, goal. Everything else has sane defaults. */
const PersonaFileSchema = z.object({
  name: z.string().min(1),
  temperature: z.enum(["cold", "warm", "hot"]),
  goal: z.string().min(1),
  tech_comfort: z.enum(["low", "medium", "high"]).default("medium"),
  patience_steps: z.number().int().min(1).max(50).default(12),
  max_confusion_before_bail: z.number().min(1).max(10).default(8),
  otp_patience_seconds: z.number().int().min(30).max(600).default(180),
  traits: z.array(z.string().min(1)).default([]),
});

/** Load every valid persona from personas/*.yaml. Invalid files are reported, not fatal. */
export function loadCustomPersonas(): {
  personas: Record<string, Persona>;
  errors: { file: string; error: string }[];
} {
  const personas: Record<string, Persona> = {};
  const errors: { file: string; error: string }[] = [];

  if (!existsSync(PERSONAS_DIR)) return { personas, errors };

  for (const file of readdirSync(PERSONAS_DIR)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const path = `${PERSONAS_DIR}/${file}`;
    try {
      const raw = parse(readFileSync(path, "utf8"));
      const res = PersonaFileSchema.safeParse(raw);
      if (!res.success) {
        errors.push({
          file,
          error: res.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
        continue;
      }
      const id = file.replace(/\.ya?ml$/, "");
      personas[id] = res.data as Persona;
    } catch (e) {
      errors.push({ file, error: `YAML parse error: ${(e as Error).message.slice(0, 100)}` });
    }
  }
  return { personas, errors };
}

/** Built-in presets + custom YAML (custom overrides built-in on id collision) */
export function getPersonaRegistry(): {
  personas: Record<string, Persona>;
  errors: { file: string; error: string }[];
} {
  const { personas: custom, errors } = loadCustomPersonas();
  return { personas: { ...PERSONAS, ...custom }, errors };
}

export function resolvePersona(id: string): Persona | null {
  const { personas } = getPersonaRegistry();
  return personas[id] ?? null;
}

/** Scaffold a ready-to-edit persona file */
export function newPersonaFile(name: string): string {
  if (!existsSync(PERSONAS_DIR)) mkdirSync(PERSONAS_DIR, { recursive: true });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const path = `${PERSONAS_DIR}/${id}.yaml`;
  if (existsSync(path)) throw new Error(`${path} already exists`);
  writeFileSync(
    path,
    `# Persona: ${name}
# Full guide: AGENTS.md — drop this file in personas/ and it is picked up automatically.

name: "${name}"
temperature: cold            # cold = skeptical first-timer | warm = evaluating | hot = ready to buy
goal: >-
  Figure out what this product does and whether it solves my problem.
  Sign up only if it is clearly worth it.
tech_comfort: medium         # low | medium | high
patience_steps: 12           # max steps before giving up (1-50)
max_confusion_before_bail: 8 # confusion level that pushes toward abandoning (1-10)
otp_patience_seconds: 180    # how long to wait for verification emails (30-600)

traits:
  - "compares alternatives mentally"
  - "suspicious of anything that hides pricing"
  - "leaves when value is unclear"
`,
  );
  return path;
}
