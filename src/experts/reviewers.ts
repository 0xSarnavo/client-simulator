import type { Expert } from "./types.js";
import { exitSummary, trailSummary } from "./types.js";
import { fail, render } from "./copywriter.js";

export const trustExpert: Expert = {
  id: "trust",
  title: "Trust & Security Signals",
  async run(ctx, brain) {
    if (!brain.ask) return null;

    const prompt = `You are a trust/security reviewer evaluating what a prospect could and could NOT verify about this vendor during their visit.

Persona: ${ctx.persona.name} (${ctx.persona.temperature})
Outcome: ${exitSummary(ctx.exit)}

Journey trail (screenshot paths included — you may read them):
${trailSummary(ctx.events)}

Assess the trust signals the site presented (or failed to):
- proof: testimonials, logos, case studies, user counts
- transparency: pricing visibility, company identity, contact info
- security: compliance mentions, data handling, privacy policy accessibility
- dark patterns: anything manipulative the persona reacted to

Only cite things grounded in the trail or screenshots. Max 6 findings. Reply ONLY with JSON:
{
  "findings": [
    { "severity": "high"|"medium"|"low",
      "signal": "what was present or missing",
      "evidence": "quote/reference from trail or screenshot",
      "impact": "how it likely affected this prospect's decision",
      "recommendation": "what to add or change" }
  ]
}`;

    try {
      const text = await brain.ask(prompt);
      return render(text, "findings", (f: any) =>
        [
          `### [${String(f.severity).toUpperCase()}] ${f.signal}`,
          ``,
          `- **Evidence:** ${f.evidence}`,
          `- **Impact:** ${f.impact}`,
          `- **Recommendation:** ${f.recommendation}`,
          ``,
        ].join("\n"),
      );
    } catch (e) {
      return fail(this.id, e);
    }
  },
};

export const accessibilityExpert: Expert = {
  id: "a11y",
  title: "Accessibility Review",
  async run(ctx, brain) {
    if (!brain.ask) return null;

    const prompt = `You are an accessibility (a11y) reviewer. The prospect navigated this site using ONLY the accessibility tree — exactly like a screen reader user would. Their confusion and failures are a11y signals.
${"```"}
Apply the installed accessibility skill (WCAG 2.2 POUR principles) as your review framework if available.
${"```"}
Persona: ${ctx.persona.name}
Outcome: ${exitSummary(ctx.exit)}

Journey trail (screenshot paths included — you may read them to compare visual vs a11y experience):
${trailSummary(ctx.events)}

Identify a11y problems evidenced by the journey:
- elements the persona couldn't find or distinguish
- unclear labels, roles, or link text ("click here")
- content only visible visually (missing from the a11y tree)
- focus/keyboard traps implied by repeated failed interactions
- confusion that sighted users might not experience

Only cite trail-evidenced issues — no generic a11y advice. Max 6 findings. Reply ONLY with JSON:
{
  "findings": [
    { "severity": "high"|"medium"|"low",
      "issue": "what was inaccessible or confusing",
      "evidence": "what happened in the trail",
      "wcag_hint": "relevant WCAG concern in plain words, or empty",
      "fix": "concrete fix" }
  ]
}`;

    try {
      const text = await brain.ask(prompt);
      return render(text, "findings", (f: any) =>
        [
          `### [${String(f.severity).toUpperCase()}] ${f.issue}`,
          ``,
          `- **Evidence:** ${f.evidence}`,
          f.wcag_hint ? `- **WCAG concern:** ${f.wcag_hint}` : "",
          `- **Fix:** ${f.fix}`,
          ``,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (e) {
      return fail(this.id, e);
    }
  },
};
