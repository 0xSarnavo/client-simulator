import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Persona } from "../types.js";
import { RUNS_ROOT, siteSlug } from "../runs.js";
import { PERSONAS } from "./presets.js";

export const PERSONAS_DIR = resolve("personas");

/**
 * Personas generated for one site live beside that site's runs, not in the flat
 * global directory — a set built for a scraping API is noise when you test a
 * checkout, and the two used to sit next to each other with nothing saying which
 * was which.
 */
export function sitePersonasDir(url: string): string {
  return resolve(`${RUNS_ROOT}/${siteSlug(url)}/personas`);
}

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

/** Load every valid persona from a directory of YAML. Invalid files are reported, not fatal. */
export function loadCustomPersonas(dir: string = PERSONAS_DIR): {
  personas: Record<string, Persona>;
  errors: { file: string; error: string }[];
} {
  const personas: Record<string, Persona> = {};
  const errors: { file: string; error: string }[] = [];

  if (!existsSync(dir)) return { personas, errors };

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const path = `${dir}/${file}`;
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

/**
 * Built-in presets + global `personas/` + this site's own set, in that order of
 * precedence — the most specific wins on an id collision.
 */
export function getPersonaRegistry(url?: string): {
  personas: Record<string, Persona>;
  errors: { file: string; error: string }[];
} {
  const global = loadCustomPersonas();
  const site = url
    ? loadCustomPersonas(sitePersonasDir(url))
    : { personas: {}, errors: [] as { file: string; error: string }[] };
  return {
    personas: { ...PERSONAS, ...global.personas, ...site.personas },
    errors: [...global.errors, ...site.errors],
  };
}

export function resolvePersona(id: string, url?: string): Persona | null {
  const { personas } = getPersonaRegistry(url);
  return personas[id] ?? null;
}

/**
 * Only the personas generated for this site — not the built-ins, and not the
 * global `personas/` directory.
 *
 * "Everything that is not a built-in" is the tempting definition and it is
 * wrong: a machine-local global set then counts as this site's, so generation
 * is skipped on a site that has none, and the run queue fills with personas
 * built for some other product.
 */
export function siteOwnPersonas(url: string): Record<string, Persona> {
  return loadCustomPersonas(sitePersonasDir(url)).personas;
}

/** Every site under runs/ that has a generated persona set, for listing and reuse. */
export function sitesWithPersonas(): { site: string; dir: string; personas: Record<string, Persona> }[] {
  if (!existsSync(RUNS_ROOT)) return [];
  const out: { site: string; dir: string; personas: Record<string, Persona> }[] = [];
  for (const site of readdirSync(RUNS_ROOT)) {
    const dir = `${RUNS_ROOT}/${site}/personas`;
    if (!existsSync(dir)) continue;
    const { personas } = loadCustomPersonas(resolve(dir));
    if (Object.keys(personas).length > 0) out.push({ site, dir, personas });
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
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
