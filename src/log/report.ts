import type { Persona, StepEvent, ExitReason } from "../types.js";

export function generateReport(opts: {
  persona: Persona;
  url: string;
  brain: string;
  events: StepEvent[];
  exit: ExitReason;
}): string {
  const { persona, url, brain, events, exit } = opts;
  const lines: string[] = [];

  const verdict = exitVerdict(exit);
  lines.push(`# Client-Sim Report`);
  lines.push("");
  lines.push(`- **Site:** ${url}`);
  lines.push(`- **Persona:** ${persona.name} (${persona.temperature})`);
  lines.push(`- **Brain:** ${brain}`);
  lines.push(`- **Date:** ${new Date().toISOString()}`);
  lines.push(`- **Steps taken:** ${events.length}`);
  lines.push(`- **Verdict:** ${verdict}`);
  lines.push("");

  if (exit.kind === "completed") {
    lines.push(`## Outcome`);
    lines.push("");
    lines.push(`> ${exit.summary}`);
    lines.push("");
  }

  if (exit.kind === "abandoned") {
    const last = events[events.length - 1];
    lines.push(`## Drop-off`);
    lines.push("");
    lines.push(`- **Dropped at step:** ${last?.n ?? "?"} (${last?.url ?? url})`);
    lines.push(`- **In their own words:** "${exit.reason}"`);
    lines.push(`- **Wanted answered:** "${exit.question}"`);
    lines.push("");
  }

  if (exit.kind === "guardrail") {
    lines.push(`## Terminated by guardrail`);
    lines.push("");
    lines.push(`${exit.detail}`);
    lines.push("");
  }

  lines.push(`## Journey Timeline`);
  lines.push("");
  lines.push(`| # | URL | Thought | Emotion | Confusion | Action |`);
  lines.push(`|---|-----|---------|---------|-----------|--------|`);
  for (const e of events) {
    lines.push(
      `| ${e.n} | ${shorten(e.url)} | ${cell(e.decision.thought)} | ${cell(
        e.decision.emotion,
      )} | ${e.decision.confusion}/10 | ${actionLabel(e.decision.action)} |`,
    );
  }
  lines.push("");

  const confusions = events.map((e) => e.decision.confusion);
  if (confusions.length > 1) {
    lines.push(`## Confusion Curve`);
    lines.push("");
    lines.push("```");
    lines.push(sparkline(confusions));
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function exitVerdict(exit: ExitReason): string {
  switch (exit.kind) {
    case "completed":
      return `COMPLETED`;
    case "abandoned":
      return `ABANDONED - ${exit.reason.slice(0, 80)}`;
    case "guardrail":
      return `TERMINATED (guardrail)`;
  }
}

function actionLabel(a: StepEvent["decision"]["action"]): string {
  switch (a.type) {
    case "click":
      return `click ${a.target}`;
    case "type":
      return `type into ${a.target}`;
    case "select":
      return `select "${a.value}"`;
    case "scroll":
      return `scroll ${a.direction}`;
    case "back":
      return `go back`;
    case "wait":
      return `pause ${a.seconds}s`;
    case "check_email":
      return `check inbox (${a.seconds}s)`;
    case "complete":
      return `COMPLETE`;
    case "abandon":
      return `ABANDON`;
  }
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

function shorten(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function sparkline(values: number[]): string {
  const blocks = " ▁▂▃▄▅▆▇█";
  return values
    .map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / 10) * (blocks.length - 1)))])
    .join("");
}
