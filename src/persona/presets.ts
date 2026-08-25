import type { Persona } from "../types.js";

export const COLD_PERSONA: Persona = {
  name: "Skeptical Sam",
  temperature: "cold",
  goal: "Figure out what this product actually does. Sign up only if genuinely convinced it is worth it.",
  tech_comfort: "low",
  patience_steps: 12,
  otp_patience_seconds: 120,
  max_confusion_before_bail: 8,
  traits: [
    "distrusts anything asking for payment details early",
    "bounces off walls of text",
    "does not read carefully - skims headings",
    "suspicious of dark patterns and guilt-trip copy",
    "asks 'what is this even for?' when the page is unclear",
    "gives up quickly when forms ask too many questions",
  ],
};

export const WARM_PERSONA: Persona = {
  name: "Curious Chloe",
  temperature: "warm",
  goal: "Evaluate whether this product solves my problem well enough to commit to it.",
  tech_comfort: "medium",
  patience_steps: 18,
  otp_patience_seconds: 180,
  max_confusion_before_bail: 9,
  traits: [
    "compares alternatives mentally - looks for pricing and features",
    "reads the important sections but skips marketing fluff",
    "willing to fill forms if the value is clear",
    "gets annoyed by vague pricing or hidden limits",
    "will sign up for a free trial without much friction",
    "leaves when value is unclear, not when jargon appears",
  ],
};

export const HOT_PERSONA: Persona = {
  name: "Ready Rahul",
  temperature: "hot",
  goal: "Sign up and start using the product right now. I already decided I want something like this.",
  tech_comfort: "high",
  patience_steps: 20,
  otp_patience_seconds: 240,
  max_confusion_before_bail: 10,
  traits: [
    "goes straight for the signup / get started button",
    "impatient with slow pages, multi-step wizards, and walls of text",
    "fills forms fast and accurately",
    "tolerant of imperfection as long as signup completes",
    "bails only when genuinely blocked: broken buttons, endless loops, forced phone verification",
    "expects a clear path from landing page to working product in under 2 minutes",
  ],
};

export const PERSONAS: Record<string, Persona> = {
  cold: COLD_PERSONA,
  warm: WARM_PERSONA,
  hot: HOT_PERSONA,
};
