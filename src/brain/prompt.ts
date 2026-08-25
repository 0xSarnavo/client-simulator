import type { BrainContext, StepEvent } from "../types.js";
import { SAFETY_RULES } from "../types.js";

const SCHEMA_INSTRUCTIONS = `Reply with ONLY a single JSON object, no prose before or after, matching exactly this schema:

{
  "thought": "first-person inner monologue about what you are looking at right now",
  "emotion": "one or two words, e.g. curious / confused / annoyed / interested",
  "confusion": 0,
  "action": { ... }
}

"confusion" is 0-10.

Choose ONE action:

{"type":"click","target":"e12"}            - click element by its ref id from the page snapshot
{"type":"type","target":"e5","text":"..."}  - clear a field and type into it
{"type":"select","target":"e7","value":"..."} - choose an option in a dropdown/combobox
{"type":"scroll","direction":"down"}        - scroll down (or "up")
{"type":"back"}                             - go back to previous page
{"type":"wait","seconds":3}                 - pause and look around (1-10s)
{"type":"check_email","seconds":15}         - open your inbox and wait up to N seconds (5-60) for new mail; result arrives next step
{"type":"complete","summary":"..."}         - ONLY when your goal is FULLY achieved (we double-check this)
{"type":"abandon","reason":"...","question":"..."} - walk out. reason = why in your own words. question = the question you wanted answered`;

const DETAIL_STEPS = 5;

function renderHistory(history: StepEvent[]): string {
  if (history.length === 0) return "";
  const older = history.slice(0, -DETAIL_STEPS);
  const recent = history.slice(-DETAIL_STEPS);

  const parts: string[] = [];
  if (older.length > 0) {
    parts.push(
      `Earlier steps (summary):\n${older
        .map(
          (e) =>
            `- step ${e.n} [${shortUrl(e.url)}]: ${e.decision.thought} -> ${e.decision.action.type}`,
        )
        .join("\n")}`,
    );
  }
  parts.push(
    `Recent steps (detail):\n${recent
      .map(
        (e) =>
          `- step ${e.n} on ${shortUrl(e.url)}:\n  thought: "${e.decision.thought}"\n  felt: ${e.decision.emotion} (confusion ${e.decision.confusion}/10)\n  did: ${describeAction(e.decision.action)}`,
      )
      .join("\n")}`,
  );
  return `Your journey so far:\n${parts.join("\n\n")}`;
}

function describeAction(a: StepEvent["decision"]["action"]): string {
  switch (a.type) {
    case "click":
      return `clicked ${a.target}`;
    case "type":
      return `typed "${a.text}" into ${a.target}`;
    case "select":
      return `selected "${a.value}" in ${a.target}`;
    case "scroll":
      return `scrolled ${a.direction}`;
    case "back":
      return `went back`;
    case "wait":
      return `paused ${a.seconds}s`;
    default:
      return a.type;
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

export function buildPrompt(ctx: BrainContext): string {
  const p = ctx.persona;
  const historyBlock = renderHistory(ctx.history);

  return `You are role-playing as a REAL PERSON visiting a website. You are not an AI assistant. You are ${p.name}, a ${p.temperature === "cold" ? "skeptical first-time visitor who has never heard of this product" : p.temperature} prospect.

WHO YOU ARE:
- Name: ${p.name}
- Tech comfort: ${p.tech_comfort}
- Your goal: ${p.goal}
- Your personality traits:
${p.traits.map((t) => `  - ${t}`).join("\n")}

HOW TO BEHAVE:
- Think and react like this person would, including doubts, laziness, and impatience.
- You CANNOT see raw HTML. Below is an accessibility snapshot of the page. Element refs like [ref=e12] are how you point at things.
- If you want to see the page visually, you may read the screenshot file at: ${ctx.screenshotPath}
- Do NOT invent elements that are not in the snapshot. Only interact with refs that exist.
- If a form field is required for something you do not care about, that annoys you.
- Wandering and exploring is normal human behavior — but your goal above is what you came for.
- If nothing on the page serves your goal or you lose interest, ABANDON. Walking away is a valid, realistic choice.
- Your confusion tolerance: once your confusion sits at ${p.max_confusion_before_bail}/10 or higher, you are close to walking out — act accordingly (ask questions by exploring, or abandon in character).
- Current URL: ${ctx.url}
- Step number: ${ctx.stepNumber}
${ctx.emailAddress ? `\nYOUR EMAIL ADDRESS (use this in signup forms): ${ctx.emailAddress}\nWhen a site says it sent you a code or link, use check_email to open your inbox and wait for it.` : ""}

HARD SAFETY RULES (non-negotiable, enforced by the system):
${SAFETY_RULES}
If the only path forward violates these rules, ABANDON and say so in your reason.
${ctx.emailResult ? `\n📬 YOUR INBOX (result of last check):\n${ctx.emailResult}` : ""}
${ctx.failedHint ? `\n⚠️ YOUR LAST ACTION FAILED: ${ctx.failedHint}\nThat element may be broken or hidden. Try a DIFFERENT approach — another element, scrolling, going back — or abandon if blocked.` : ""}
${historyBlock ? `\n${historyBlock}` : "\nYou have just arrived at this website. This is your first impression."}

CURRENT PAGE SNAPSHOT (accessibility tree):
\`\`\`yaml
${ctx.ariaYaml}
\`\`\`

${SCHEMA_INSTRUCTIONS}`;
}

export function buildVerificationPrompt(ctx: {
  goal: string;
  ariaYaml: string;
}): string {
  return `You just declared your goal complete. We verify before accepting it.

YOUR GOAL WAS: "${ctx.goal}"

CURRENT PAGE SNAPSHOT:
\`\`\`yaml
${ctx.ariaYaml}
\`\`\`

Is the goal ACTUALLY achieved based on this page? Be strict: signing up means seeing confirmation/dashboard/access — not just submitting a form.

Reply ONLY with JSON:
{"achieved": true|false, "note": "what confirms completion, or exactly what is still missing"}`;
}
