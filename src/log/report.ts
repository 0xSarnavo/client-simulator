import type { Persona, StepEvent, ExitReason } from "../types.js";
import type { FlowScore } from "../site/flow.js";

/** Wall-clock the journey took, from the timestamps already on every event. */
export function journeySeconds(events: StepEvent[]): number | null {
  const stamps = events
    .map((e) => Date.parse(e.timestamp))
    .filter((t) => Number.isFinite(t));
  if (stamps.length < 2) return null;
  return Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000);
}

function durationSuffix(events: StepEvent[]): string {
  const total = journeySeconds(events);
  if (total === null) return "";
  const avg = Math.round(total / Math.max(events.length - 1, 1));
  return ` over ${fmtDuration(total)} (~${avg}s per step)`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function generateReport(opts: {
  persona: Persona;
  url: string;
  brain: string;
  events: StepEvent[];
  exit: ExitReason;
  /** Which flow checkpoints this journey reached, when a flow was defined */
  flow?: FlowScore;
}): string {
  const { persona, url, brain, events, exit, flow } = opts;
  const lines: string[] = [];

  const verdict = exitVerdict(exit);
  lines.push(`# Client-Sim Report`);
  lines.push("");
  lines.push(`- **Site:** ${url}`);
  lines.push(`- **Persona:** ${persona.name} (${persona.temperature})`);
  lines.push(`- **Brain:** ${brain}`);
  lines.push(`- **Date:** ${new Date().toISOString()}`);
  lines.push(`- **Steps taken:** ${events.length}${durationSuffix(events)}`);
  lines.push(`- **Verdict:** ${verdict}`);
  lines.push(`- **Read as:** one simulated visitor — a risk signal, not measured traffic`);
  lines.push("");

  if (flow && flow.length > 0) {
    lines.push(`## Flow Checkpoints (${flow.filter((c) => c.reached).length}/${flow.length} reached)`);
    lines.push("");
    for (const c of flow) {
      lines.push(`- ${c.reached ? "✅" : "⬜"} ${cell(c.checkpoint)}${c.note ? ` — ${cell(c.note)}` : ""}`);
    }
    lines.push("");
  }

  // Which pages the journey actually reached, and what it took to get there —
  // a page that takes eight steps to find is a finding in itself.
  const firstSeen = new Map<string, StepEvent>();
  for (const e of events) {
    const key = e.url.split("#")[0];
    if (!firstSeen.has(key)) firstSeen.set(key, e);
  }
  if (firstSeen.size > 0) {
    const start = Math.min(...events.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite));
    lines.push(`## Pages Reached (${firstSeen.size})`);
    lines.push("");
    lines.push(`| Page | First reached | Steps in | Time in |`);
    lines.push(`|------|---------------|----------|---------|`);
    for (const [pageUrl, e] of firstSeen) {
      const secs = Number.isFinite(start) ? Math.round((Date.parse(e.timestamp) - start) / 1000) : null;
      lines.push(
        `| ${shorten(pageUrl)} | step ${e.n} | ${e.n} | ${secs === null ? "—" : fmtDuration(secs)} |`,
      );
    }
    lines.push("");
  }

  if (exit.kind === "completed") {
    lines.push(`## Outcome`);
    lines.push("");
    lines.push(`> ${exit.summary}`);
    lines.push("");
  }

  if (exit.kind === "abandoned") {
    const last = events[events.length - 1];
    lines.push(`## Drop-off risk — this prospect walked out`);
    lines.push("");
    lines.push(`- **Walked out at step:** ${last?.n ?? "?"} (${last?.url ?? url})`);
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
  lines.push(`| # | At | URL | Thought | Emotion | Confusion | Action |`);
  lines.push(`|---|----|-----|---------|---------|-----------|--------|`);
  const start = Math.min(...events.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite));
  for (const e of events) {
    // seconds since the journey began — shows where a persona stalled
    const at = Number.isFinite(Date.parse(e.timestamp)) && Number.isFinite(start)
      ? `+${Math.round((Date.parse(e.timestamp) - start) / 1000)}s`
      : "—";
    lines.push(
      `| ${e.n} | ${at} | ${shorten(e.url)} | ${cell(e.decision.thought)} | ${cell(
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
