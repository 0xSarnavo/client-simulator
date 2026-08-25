import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import type { Brain } from "../types.js";
import { PERSONAS_DIR } from "./load.js";

const GeneratedPersonaSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id")
    .max(40),
  name: z.string().min(1),
  temperature: z.enum(["cold", "warm", "hot"]),
  goal: z.string().min(1),
  tech_comfort: z.enum(["low", "medium", "high"]).default("medium"),
  patience_steps: z.number().int().min(1).max(50).default(12),
  max_confusion_before_bail: z.number().min(1).max(10).default(8),
  otp_patience_seconds: z.number().int().min(30).max(600).default(180),
  traits: z.array(z.string().min(1)).min(4).max(10),
  /** which node in the persona graph this fills */
  relation: z.enum(["core", "nearest-neighbor"]).default("core"),
});

const GeneratedSetSchema = z.array(GeneratedPersonaSchema);

export interface GenerateOptions {
  description: string;
  count: number;
  brain: Brain & { ask?(prompt: string): Promise<string> };
  /** optional target site — scraped to learn what the product is and who it serves */
  site?: string;
}

export interface GeneratedPersona extends z.infer<typeof GeneratedPersonaSchema> {
  file: string;
}

/** Scrape the target landing page (a11y text) so personas fit the actual product */
async function scrapeSiteContext(url: string): Promise<string> {
  const { BrowserDriver } = await import("../browser/driver.js");
  const driver = new BrowserDriver();
  try {
    const tmp = `/tmp/opencode/clientsim-scrape-${Date.now()}`;
    mkdirSync(tmp, { recursive: true });
    await driver.launch({ headless: true, shotsDir: tmp });
    await driver.goto(url);
    const snap = await driver.snapshot();
    // strip refs — we only need meaning, not targets
    const text = snap.ariaYaml.replace(/\[ref=\w+\]/g, "").slice(0, 4000);
    return text;
  } catch (e) {
    console.log(`  (could not scrape site: ${(e as Error).message.slice(0, 80)})`);
    return "";
  } finally {
    await driver.close();
  }
}

export async function generatePersonas(
  opts: GenerateOptions,
): Promise<{ written: GeneratedPersona[]; graph: string }> {
  if (!opts.brain.ask) throw new Error("brain does not support ask()");
  const count = Math.max(2, Math.min(10, opts.count));

  let siteContext = "";
  if (opts.site) {
    console.log(`  scraping ${opts.site} to understand the product...`);
    siteContext = await scrapeSiteContext(opts.site);
    if (siteContext) console.log(`  got ${siteContext.length} chars of page context`);
  }

  const prompt = `You are a senior user researcher. Design synthetic test prospects for onboarding testing.
Apply the installed user-personas skill (persona construction methodology) if available.

PRODUCT CONTEXT${opts.site ? " (scraped from the live site)" : ""}:
${siteContext || "(no site provided - rely on the description below)"}

THE USER'S IDEAL CUSTOMERS:
${opts.description}

Generate ${count} DISTINCT prospect personas as a persona graph:
- 1-2 "core" personas: the ideal customers described above, most likely to convert
- the rest "nearest-neighbor" variants: adjacent roles, company sizes, or industries that plausibly buy the same product but behave differently (companies differ!)

ANTI-SIMILARITY RULES (strict):
- No trait may appear in two personas.
- Each persona must have a different COMPLETE condition in its goal.
- Vary temperature across the set (mix cold/warm/hot where realistic).
- Traits are written as concrete behavioral rules, not adjectives.

Reply ONLY with a JSON array:
[{
  "id": "kebab-case-unique-id",
  "name": "Persona Name (Role)",
  "temperature": "cold"|"warm"|"hot",
  "goal": "first-person goal including their personal COMPLETE condition",
  "tech_comfort": "low"|"medium"|"high",
  "patience_steps": 8-24,
  "max_confusion_before_bail": 5-9,
  "otp_patience_seconds": 60-300,
  "traits": ["6-8 concrete behavioral rules"],
  "relation": "core"|"nearest-neighbor"
}]`;

  const text = await opts.brain.ask(prompt);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("brain reply contained no JSON array");
  const parsed = GeneratedSetSchema.parse(JSON.parse(text.slice(start, end + 1)));

  if (!existsSync(PERSONAS_DIR)) mkdirSync(PERSONAS_DIR, { recursive: true });

  const written: GeneratedPersona[] = [];
  for (const p of parsed.slice(0, count)) {
    const file = resolve(PERSONAS_DIR, `${p.id}.yaml`);
    if (existsSync(file)) {
      console.log(`  ! skipped ${p.id}.yaml (already exists)`);
      continue;
    }
    const { relation, ...persona } = p;
    writeFileSync(
      file,
      `# ${p.name} — ${relation} persona (generated)\n# Review and edit freely; delete the file to remove.\n\n${stringify(persona)}\n`,
    );
    written.push({ ...p, file });
  }

  // render the persona graph
  const core = written.filter((p) => p.relation === "core");
  const neighbors = written.filter((p) => p.relation !== "core");
  const lines = ["", "  persona graph:", ""];
  for (const c of core) {
    lines.push(`  ● ${c.id} (${c.name}) — core ideal customer`);
    const related = neighbors.filter(
      (n) => n.temperature === c.temperature || n.tech_comfort === c.tech_comfort,
    );
    for (const n of related) {
      lines.push(`     ├─ ○ ${n.id} (${n.name}) — nearest neighbor`);
    }
  }
  const orphans = neighbors.filter(
    (n) => !core.some((c) => n.temperature === c.temperature || n.tech_comfort === c.tech_comfort),
  );
  for (const n of orphans) lines.push(`  ○ ${n.id} (${n.name}) — nearest neighbor`);

  return { written, graph: lines.join("\n") };
}
