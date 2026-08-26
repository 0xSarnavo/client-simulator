import { z } from "zod";

export interface Persona {
  name: string;
  temperature: "cold" | "warm" | "hot";
  goal: string;
  tech_comfort: "low" | "medium" | "high";
  patience_steps: number;
  max_confusion_before_bail: number;
  /** How long this persona will keep checking email for a code/link before giving up (seconds) */
  otp_patience_seconds: number;
  traits: string[];
}

/**
 * Told to the persona. The first two are also enforced mechanically in
 * safety.ts — the harness refuses those actions whatever the model decides.
 * The third is prompt-only, so do not describe it as guaranteed.
 */
export const SAFETY_RULES = `- You may LOOK at pricing, billing and checkout pages — seeing them is useful. But you NEVER actually pay: no card details, and never the final "Pay"/"Place order" button. The system blocks it anyway.
- You NEVER sign in with Google/GitHub/Apple/SSO. Use email signup, or walk away. The system blocks it anyway.
- You NEVER delete data or send invites to teammates.`;

export const DecisionSchema = z.object({
  thought: z.string().describe("First-person inner monologue about what you see"),
  emotion: z.string().describe("Current emotional state, one or two words"),
  confusion: z.number().min(0).max(10).describe("Confusion level 0-10"),
  action: z.union([
    z.object({ type: z.literal("click"), target: z.string() }),
    z.object({ type: z.literal("type"), target: z.string(), text: z.string() }),
    z.object({
      type: z.literal("select"),
      target: z.string(),
      value: z.string(),
    }),
    z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
    z.object({ type: z.literal("back") }),
    z.object({ type: z.literal("wait"), seconds: z.number().min(1).max(10) }),
    z.object({
      type: z.literal("check_email"),
      seconds: z.number().min(5).max(60),
    }),
    z.object({
      type: z.literal("complete"),
      summary: z.string(),
    }),
    z.object({
      type: z.literal("abandon"),
      reason: z.string(),
      question: z.string(),
    }),
  ]),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionAction = Decision["action"];

/** Schema for a line of session.jsonl — shared artifacts are untrusted input. */
export const StepEventSchema = z.object({
  n: z.number(),
  url: z.string(),
  timestamp: z.string(),
  screenshot: z.string().optional(),
  decision: DecisionSchema,
  note: z.string().optional(),
});

export const ExitReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("completed"), summary: z.string() }),
  z.object({ kind: z.literal("abandoned"), reason: z.string(), question: z.string() }),
  z.object({ kind: z.literal("guardrail"), detail: z.string() }),
]);

export const VerdictSchema = z.object({
  achieved: z.boolean(),
  note: z.string().describe("What is missing or what confirms completion"),
});

export type StepEvent = {
  n: number;
  url: string;
  timestamp: string;
  screenshot?: string;
  decision: Decision;
  /** e.g. why a "complete" claim was rejected by verification */
  note?: string;
};

export type ExitReason =
  | { kind: "completed"; summary: string }
  | { kind: "abandoned"; reason: string; question: string }
  | { kind: "guardrail"; detail: string };

export interface BrainContext {
  persona: Persona;
  ariaYaml: string;
  screenshotPath: string;
  url: string;
  stepNumber: number;
  /** Full journey so far — recent steps rendered in detail by the prompt builder */
  history: StepEvent[];
  /** Set when the previous action failed, so the brain can change approach */
  failedHint?: string;
  /** The persona's ephemeral mailbox address (when mail is configured) */
  emailAddress?: string;
  /** Result of the last check_email action, rendered for the next think step */
  emailResult?: string;
}

export interface Brain {
  name: string;
  decide(ctx: BrainContext): Promise<Decision>;
  /** Free-form question inside the same persistent session (verification etc.) */
  ask?(prompt: string): Promise<string>;
}
