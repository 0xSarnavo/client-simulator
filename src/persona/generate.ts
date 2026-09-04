import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  /** how far this persona sits from the ideal customer */
  relation: z.enum(["core", "adjacent", "edge"]).default("core"),
});

export interface GenerateOptions {
  /** Ideal-customer description. Optional when a site is given — the audience is inferred. */
  description?: string;
  count: number;
  brain: Brain & { ask?(prompt: string): Promise<string> };
  /** optional target site — scraped to learn what the product is and who it serves */
  site?: string;
  /** where the YAML lands. Defaults to the global personas/ directory. */
  outDir?: string;
  /** page context already scraped by the caller, so a site is not read twice */
  siteContext?: string;
  /** the flow under test — persona goals become variations of it */
  flowContext?: string;
}

export interface GeneratedPersona extends z.infer<typeof GeneratedPersonaSchema> {
  file: string;
}

/** Scrape the target landing page (a11y text) so personas fit the actual product */
export async function scrapeSiteContext(url: string): Promise<string> {
  const { BrowserDriver } = await import("../browser/driver.js");
  const driver = new BrowserDriver();
  // a fixed /tmp path was both predictable (another local user can pre-plant it)
  // and never cleaned up — mkdtemp gives a private 0700 dir we can delete after
  const tmp = mkdtempSync(join(tmpdir(), "clientsim-scrape-"));
  try {
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
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function generatePersonas(
  opts: GenerateOptions,
): Promise<{ written: GeneratedPersona[]; graph: string }> {
  if (!opts.brain.ask) throw new Error("brain does not support ask()");
  const count = Math.max(2, Math.min(10, opts.count));

  let siteContext = opts.siteContext ?? "";
  if (!siteContext && opts.site) {
    console.log(`  scraping ${opts.site} to understand the product...`);
    siteContext = await scrapeSiteContext(opts.site);
    if (siteContext) console.log(`  got ${siteContext.length} chars of page context`);
  }

  const prompt = `You are a senior user researcher. Design synthetic test prospects for onboarding testing.
Apply the installed user-personas skill (persona construction methodology) if available.

PRODUCT CONTEXT${opts.site ? " (scraped from the live site)" : ""}:
${siteContext || "(no site provided - rely on the description below)"}

WHO THE PRODUCT IS FOR:
${opts.description || "(not stated - infer it from the product context above)"}
${
  opts.flowContext
    ? `
THE FLOW UNDER TEST:
${opts.flowContext}

Every persona's goal must be a personal variation of this flow — their own
reason for attempting it, their own COMPLETE condition within it. Edge personas
may fail or bail early, but they still enter through this flow.
`
    : ""
}
Generate ${count} DISTINCT personas covering the FULL RANGE of people who actually
land on this site - not variations on one ideal buyer. Onboarding has to work for
everyone who shows up, so spread the set across three tiers:

- "core" (about a third): the ideal customers, most likely to convert.
- "adjacent" (about a third): different roles, seniorities, company sizes or
  industries who could plausibly buy but behave differently.
- "edge" (about a third): people who land here but are NOT the target - wrong use
  case, no budget, a competitor sizing you up, a student, someone who clicked the
  wrong ad, an enterprise buyer hitting a self-serve flow. These reveal whether the
  onboarding qualifies people quickly or wastes their time.

SPREAD ACROSS THESE CIRCUMSTANCES TOO (independent of tier):
- tech comfort: at least one "low" in the set
- urgency: some idly browsing, some needing a solution today
- trust posture: at least one privacy-sensitive or previously-burned visitor
- budget: at least one who checks price before anything else
- reading style: at least one who skims (non-native English reader, or in a hurry)
${count >= 4 ? '- accessibility: at least one with a real constraint (keyboard-only, screen reader, low vision) reflected in their traits\n' : ""}
STRICT RULES:
- Any two personas must differ on at least THREE of the axes above.
- No trait may appear in two personas.
- Each persona needs a different COMPLETE condition in its goal.
- Mix temperatures across the set - do not make them all warm.
- Traits are concrete behavioral rules ("leaves if a card is required for a trial"),
  never adjectives ("cautious").

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
  "relation": "core"|"adjacent"|"edge"
}]`;

  const text = await opts.brain.ask(prompt);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("brain reply contained no JSON array");
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("brain reply was not a JSON array");

  // salvage per element — one persona answering tech_comfort "medium-high"
  // must not throw away the nine valid ones beside it (same failure class as
  // the expert scorecard, 24de073)
  const parsed: z.infer<typeof GeneratedPersonaSchema>[] = [];
  let dropped = 0;
  for (const item of raw) {
    const r = GeneratedPersonaSchema.safeParse(item);
    if (r.success) parsed.push(r.data);
    else {
      dropped++;
      const first = r.error.issues[0];
      console.log(
        `  ! dropped a malformed persona (${first?.path.join(".")}: ${first?.message})`,
      );
    }
  }
  if (parsed.length === 0) throw new Error(`all ${dropped} personas in the reply were malformed`);

  const outDir = opts.outDir ?? PERSONAS_DIR;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const written: GeneratedPersona[] = [];
  for (const p of parsed.slice(0, count)) {
    const file = resolve(outDir, `${p.id}.yaml`);
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

  // coverage summary: how far the set actually spreads from the ideal customer
  const TIERS = [
    { key: "core", mark: "●", label: "core     ", note: "ideal customer" },
    { key: "adjacent", mark: "○", label: "adjacent ", note: "different role / size / industry" },
    { key: "edge", mark: "◌", label: "edge     ", note: "lands here but is not the target" },
  ] as const;

  const lines = ["", "  persona coverage:", ""];
  for (const tier of TIERS) {
    const members = written.filter((p) => p.relation === tier.key);
    if (members.length === 0) continue;
    lines.push(`  ${tier.mark} ${tier.label} ${tier.note}`);
    for (const p of members) {
      lines.push(`      ${p.id} — ${p.name} (${p.temperature}, ${p.tech_comfort} tech)`);
    }
    lines.push("");
  }

  return { written, graph: lines.join("\n") };
}
