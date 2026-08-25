import type { Brain, ExitReason, Persona, StepEvent } from "../types.js";

export interface ExpertContext {
  persona: Persona;
  url: string;
  events: StepEvent[];
  exit: ExitReason;
  /** "desktop" (default) or "mobile" — session was run at 390×844 touch */
  viewport?: string;
}

/** A specialist agent that reviews a completed session and returns a markdown section */
export interface Expert {
  id: string;
  title: string;
  run(ctx: ExpertContext, brain: Brain): Promise<string | null>;
}

export function trailSummary(events: StepEvent[]): string {
  return events
    .map(
      (e) =>
        `step ${e.n} [${e.url}] confusion ${e.decision.confusion}/10 (${e.decision.emotion}): "${e.decision.thought}" -> ${e.decision.action.type}${e.note ? ` [note: ${e.note}]` : ""}`,
    )
    .join("\n");
}

export function exitSummary(exit: ExitReason): string {
  switch (exit.kind) {
    case "completed":
      return `completed the goal: ${exit.summary}`;
    case "abandoned":
      return `abandoned: "${exit.reason}" (wanted answered: "${exit.question}")`;
    case "guardrail":
      return `terminated by guardrail: ${exit.detail}`;
  }
}
