import type { Expert } from "./types.js";
import { exitSummary, trailSummary, siteContext } from "./types.js";

export const copywriterExpert: Expert = {
  id: "copywriter",
  title: "Copy & Messaging",
  async run(ctx, brain) {
    if (!brain.ask) return null;

    const prompt = `You are a senior conversion copywriter. A simulated prospect went through this website. Your job: rewrite the copy that confused, annoyed, or lost them.
Apply the installed landing-page-copywriter and ux-writing skills (conversion copy + microcopy frameworks) if available.

${siteContext(ctx)}
Persona: ${ctx.persona.name} (${ctx.persona.temperature}, tech comfort: ${ctx.persona.tech_comfort})
Goal: ${ctx.persona.goal}
Outcome: ${exitSummary(ctx.exit)}

Journey trail (with screenshot paths you may read to see the actual pages):
${trailSummary(ctx.events)}

For each moment where COPY (headlines, CTAs, button labels, form labels, empty states, error messages) caused friction:
1. Quote the offending copy as it likely appeared
2. Explain why it failed THIS persona
3. Provide a rewritten version

Only rewrite copy that the trail implicates. Max 5 rewrites. Reply ONLY with JSON:
{
  "rewrites": [
    { "location": "hero headline / signup button / pricing section / error message etc.",
      "current": "the copy as encountered (best inference from trail)",
      "why_failed": "why this persona stumbled on it",
      "rewrite": "the improved copy",
      "why_better": "one sentence on the principle applied" }
  ]
}`;

    try {
      const text = await brain.ask(prompt);
      return render(text, "rewrites", (r: any) =>
        [
          `### ${r.location}`,
          ``,
          `> **Current:** "${r.current}"`,
          `> **Why it failed:** ${r.why_failed}`,
          ``,
          `**Rewrite:** "${r.rewrite}"`,
          ``,
          `*Why better:* ${r.why_better}`,
          ``,
        ].join("\n"),
      );
    } catch (e) {
      return fail(this.id, e);
    }
  },
};

/** Extract the first balanced JSON object from arbitrary CLI reply text */
export function parseJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function render(
  text: string,
  key: string,
  itemRenderer: (item: any) => string,
): string | null {
  const parsed = parseJsonObject(text);
  const items = parsed?.[key];
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.map(itemRenderer).join("\n");
}

export function fail(id: string, e: unknown): null {
  console.error(`  [${id}] expert failed: ${(e as Error).message.slice(0, 160)}`);
  return null;
}
