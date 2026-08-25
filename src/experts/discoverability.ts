import type { Expert } from "./types.js";
import { exitSummary, trailSummary } from "./types.js";
import { fail, render } from "./copywriter.js";

export const slopExpert: Expert = {
  id: "slop",
  title: "AI Slop Finder",
  async run(ctx, brain) {
    if (!brain.ask) return null;

    const prompt = `You are an AI-slop detector for marketing copy. A prospect visited this site; find every piece of copy that reads as unedited AI-generated filler.
Apply the installed no-ai-slop skill (AI-writing tells and fixes) if available.

Persona: ${ctx.persona.name} (${ctx.persona.temperature})
Outcome: ${exitSummary(ctx.exit)}

Journey trail (screenshot paths included — you may read them to see the actual copy; you may also curl the URL for full text):
${trailSummary(ctx.events)}

AI-slop tells to hunt for:
- filler openers ("in today's fast-paced digital landscape", "unlock the power of")
- "It's not just X, it's Y" constructions, rule-of-three abuse
- em-dash overuse, "seamless", "robust", "elevate", "supercharge", "game-changer"
- generic testimonials with no names/details, vague value claims
- identical sentence rhythm across sections, bullet lists that say nothing

Only flag copy evidenced in the trail/screenshots/page text. Quote each verbatim. If the copy is genuinely human and specific, say so — do not invent findings. Max 6. Reply ONLY with JSON:
{
  "findings": [
    { "severity": "high"|"medium"|"low",
      "slop": "the verbatim slop text",
      "tell": "which AI tell it exhibits",
      "why_it_hurts": "how it reads to the persona",
      "rewrite": "specific, human-sounding replacement" }
  ],
  "verdict": "one line: overall how much of the site copy reads AI-generated"
}`;

    try {
      const text = await brain.ask(prompt);
      const parsed = parseJsonObject(text);
      const items = parsed?.findings;
      if (!Array.isArray(items) || items.length === 0) {
        return parsed?.verdict ? `**Verdict:** ${parsed.verdict}\n` : null;
      }
      const body = render(text, "findings", (f: any) =>
        [
          `### [${String(f.severity).toUpperCase()}] ${f.tell}`,
          ``,
          `> **Found:** "${f.slop}"`,
          `> **Why it hurts:** ${f.why_it_hurts}`,
          ``,
          `**Human rewrite:** "${f.rewrite}"`,
          ``,
        ].join("\n"));
      return body && parsed?.verdict ? `${body}\n**Verdict:** ${parsed.verdict}\n` : body;
    } catch (e) {
      return fail(this.id, e);
    }
  },
};

// shared with other experts in this file
import { parseJsonObject } from "./copywriter.js";

export const seoExpert: Expert = {
  id: "seo",
  title: "On-Page SEO Basics",
  async run(ctx, brain) {
    if (!brain.ask) return null;

    const prompt = `You are an SEO auditor doing an on-page basics check. A prospect visited this page; assess what search engines see.
Apply the installed seo-audit skill (on-page SEO checklist) if available.

Persona: ${ctx.persona.name}
Outcome: ${exitSummary(ctx.exit)}

Journey trail (screenshot paths included; you may also curl ${ctx.url} to inspect raw HTML for title/meta/heading/alt/structure):
${trailSummary(ctx.events)}

Check the on-page basics only (this is a single-page audit, not a crawl):
- title tag: present, unique, describes the product, reasonable length
- meta description: present, compelling, correct length
- heading structure: one h1, logical h2/h3 hierarchy
- content quality: substance vs thin/AI-filler content (ties to slop)
- links: descriptive anchor text, no obvious broken nav
- mobile hint: anything in the trail suggesting the page breaks on small screens

Only report what you can evidence from the trail, screenshots, or fetched HTML. Max 6 findings. Reply ONLY with JSON:
{
  "findings": [
    { "severity": "high"|"medium"|"low",
      "issue": "what is wrong or missing",
      "evidence": "what you observed (trail/screenshot/HTML)",
      "fix": "concrete fix" }
  ],
  "quick_wins": ["1-3 one-line quick wins if any"]
}`;

    try {
      const text = await brain.ask(prompt);
      const parsed = parseJsonObject(text);
      const items = parsed?.findings;
      if (!Array.isArray(items) || items.length === 0) return null;
      const body = render(text, "findings", (f: any) =>
        [
          `### [${String(f.severity).toUpperCase()}] ${f.issue}`,
          ``,
          `- **Evidence:** ${f.evidence}`,
          `- **Fix:** ${f.fix}`,
          ``,
        ].join("\n"));
      const wins = Array.isArray(parsed?.quick_wins) ? parsed.quick_wins : [];
      return wins.length ? `${body}**Quick wins:**\n${wins.map((w: string) => `- ${w}`).join("\n")}\n` : body;
    } catch (e) {
      return fail(this.id, e);
    }
  },
};
