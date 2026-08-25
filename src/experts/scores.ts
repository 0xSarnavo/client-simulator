import type { Expert, ExpertContext } from "./types.js";
import { exitSummary, trailSummary } from "./types.js";
import { parseJsonObject } from "./copywriter.js";

interface Scores {
  message_clarity: { score: number; note: string };
  audience_fit: { score: number; note: string };
  action_path: { score: number; note: string };
  trust: { score: number; note: string };
  content_depth: { score: number; note: string };
}

const DIMENSIONS = [
  "message_clarity",
  "audience_fit",
  "action_path",
  "trust",
  "content_depth",
] as const;

export const scoresExpert: Expert = {
  id: "scores",
  title: "Conversion Scorecard",
  async run(ctx: ExpertContext, brain) {
    if (!brain.ask) return null;

    const prompt = `You are a conversion analyst. A simulated client just went through a website. Score the experience on 5 dimensions from THEIR perspective.

Persona: ${ctx.persona.name} (${ctx.persona.temperature}, tech comfort: ${ctx.persona.tech_comfort})
Goal: ${ctx.persona.goal}
Outcome: ${exitSummary(ctx.exit)}

Journey trail:
${trailSummary(ctx.events)}

Reply ONLY with JSON:
{
  "message_clarity": { "score": 0-10, "note": "one sentence justification" },
  "audience_fit":    { "score": 0-10, "note": "..." },
  "action_path":     { "score": 0-10, "note": "..." },
  "trust":           { "score": 0-10, "note": "..." },
  "content_depth":   { "score": 0-10, "note": "..." }
}

Definitions:
- message_clarity: could they tell what the product is and who it's for?
- audience_fit: does the page speak to THIS persona's needs?
- action_path: how clear and friction-free was the path to the main action?
- trust: proof, pricing transparency, social evidence, absence of dark patterns
- content_depth: enough substance to evaluate claims without being a wall of text`;

    try {
      const text = await brain.ask(prompt);
      const parsed = extractScores(text);
      if (!parsed) return null;
      return render(parsed);
    } catch (e) {
      console.error(
        `  [${this.id}] expert failed: ${(e as Error).message.slice(0, 160)}`,
      );
      return null;
    }
  },
};

function extractScores(text: string): Scores | null {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;
  const valid = DIMENSIONS.every(
    (d) =>
      parsed[d] &&
      typeof parsed[d].score === "number" &&
      typeof parsed[d].note === "string",
  );
  return valid ? parsed : null;
}

function render(scores: Scores): string {
  const lines = [
    `| Dimension | Score | Notes |`,
    `|-----------|-------|-------|`,
  ];
  let total = 0;
  for (const d of DIMENSIONS) {
    total += scores[d].score;
    const bar = "█".repeat(Math.round(scores[d].score)) + "░".repeat(10 - Math.round(scores[d].score));
    lines.push(`| ${d.replace(/_/g, " ")} | \`${bar}\` ${scores[d].score}/10 | ${scores[d].note} |`);
  }
  lines.push("");
  lines.push(`**Overall: ${(total / DIMENSIONS.length).toFixed(1)}/10**`);
  lines.push("");
  return lines.join("\n");
}
