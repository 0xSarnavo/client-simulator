import type { Expert, ExpertContext } from "./types.js";
import { exitSummary, trailSummary } from "./types.js";
import { parseJsonObject } from "./copywriter.js";

export const uxExpert: Expert = {
  id: "ux",
  title: "UX & Conversion",
  async run(ctx: ExpertContext, brain) {
    if (!brain.ask) return null;

    const prompt = `You are a senior product/UX consultant. A simulated client with this profile just went through a website.
Apply the installed web-design-reviewer, landing-page-conversion-audit, and critique-information-density skills (UX heuristics, conversion frameworks, content-length/overload review) if available.
${ctx.viewport === "mobile" ? "This session ran on a MOBILE viewport (390×844, touch) — judge mobile layout, tap targets, and content length on small screens." : "This session ran on a desktop viewport (1280×800)."}

Persona: ${ctx.persona.name} (${ctx.persona.temperature}, tech comfort: ${ctx.persona.tech_comfort})
Goal: ${ctx.persona.goal}
Outcome: ${exitSummary(ctx.exit)}

Their full journey trail:
${trailSummary(ctx.events)}

Produce prioritized, shippable recommendations for the site's team. Focus on the exact friction points in the trail. Reply ONLY with JSON:
{
  "recommendations": [
    { "priority": "high"|"medium"|"low", "problem": "...", "evidence": "quote or reference from the trail", "fix": "concrete next move the team can ship", "copy_rewrite": "optional suggested rewrite of the offending copy, or empty string" }
  ]
}
Maximum 6 recommendations, ordered by impact.`;

    try {
      const text = await brain.ask(prompt);
      const parsed = parseJsonObject(text);
      const recs = parsed?.recommendations;
      if (!Array.isArray(recs) || recs.length === 0) return null;
      return renderRecommendations(recs);
    } catch (e) {
      console.error(
        `  [${this.id}] expert failed: ${(e as Error).message.slice(0, 160)}`,
      );
      return null;
    }
  },
};

interface Recommendation {
  priority: string;
  problem: string;
  evidence: string;
  fix: string;
  copy_rewrite: string;
}

export function renderRecommendations(recs: Partial<Recommendation>[]): string {
  const lines: string[] = [];
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  // drop only the entries that say nothing — a single malformed item used to
  // throw on .toUpperCase() and take the whole section down with it
  const usable = recs.filter((r) => r && (r.problem || r.fix));
  const sorted = [...usable].sort(
    (a, b) => (order[String(a.priority)] ?? 3) - (order[String(b.priority)] ?? 3),
  );
  for (const r of sorted) {
    lines.push(`### [${String(r.priority ?? "medium").toUpperCase()}] ${r.problem ?? "(unspecified)"}`);
    lines.push("");
    if (r.evidence) lines.push(`- **Evidence:** ${r.evidence}`);
    if (r.fix) lines.push(`- **Fix:** ${r.fix}`);
    if (r.copy_rewrite) lines.push(`- **Copy rewrite:** "${r.copy_rewrite}"`);
    lines.push("");
  }
  return lines.join("\n");
}
