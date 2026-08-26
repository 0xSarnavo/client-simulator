import type { Persona, StepEvent, ExitReason } from "../types.js";
import type { BrainUsage } from "../brain/adapters/cli-brain.js";

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

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
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
  /** Token/cost totals for the run, when the brain reported them */
  usage?: BrainUsage;
}): string {
  const { persona, url, brain, events, exit, usage } = opts;
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
  if (usage?.reported) {
    const totalIn = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
    lines.push(
      `- **Cost:** ${usage.calls} AI calls · ${fmtTokens(totalIn)} in ` +
        `(${fmtTokens(usage.cacheReadTokens)} cached) · ${fmtTokens(usage.outputTokens)} out · ` +
        `$${usage.costUsd.toFixed(2)}`,
    );
  }
  lines.push("");

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
