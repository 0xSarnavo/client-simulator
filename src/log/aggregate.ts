import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { ExitReason, StepEvent } from "../types.js";
import { ExitReasonSchema, StepEventSchema } from "../types.js";
import { PERSONAS } from "../persona/presets.js";
import { fmtDuration, journeySeconds } from "./report.js";
export { siteSlug } from "../runs.js";

export interface SessionMeta {
  url: string;
  personaId: string;
  brain: string;
  exit: ExitReason;
  date?: string;
}

const MetaSchema = z.object({
  url: z.string(),
  personaId: z.string(),
  brain: z.string(),
  exit: ExitReasonSchema,
});

/**
 * Sessions are shared artifacts — a donated runs/ folder is untrusted input.
 * Validate shape at the boundary: invalid sessions are skipped with a warning
 * instead of crashing stages 2-3 mid-report.
 */
export function loadSessions(dirs: string[]): {
  dir: string;
  meta: SessionMeta;
  events: StepEvent[];
}[] {
  const sessions = [];
  for (const dir of dirs) {
    const metaPath = `${dir}/meta.json`;
    const eventsPath = `${dir}/session.jsonl`;
    if (!existsSync(metaPath) || !existsSync(eventsPath)) continue;
    try {
      const metaRaw = JSON.parse(readFileSync(metaPath, "utf8"));
      const metaRes = MetaSchema.safeParse(metaRaw);
      if (!metaRes.success) {
        console.warn(`  ⚠ skipping ${dir}: meta.json has an unexpected shape`);
        continue;
      }
      const meta = metaRes.data as SessionMeta;

      const events: StepEvent[] = [];
      let badLines = 0;
      for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const res = StepEventSchema.safeParse(JSON.parse(line));
          if (res.success) events.push(res.data);
          else badLines++;
        } catch {
          badLines++;
        }
      }
      if (events.length === 0) {
        console.warn(`  ⚠ skipping ${dir}: no valid step events in session.jsonl`);
        continue;
      }
      if (badLines > 0) {
        console.warn(`  ⚠ ${dir}: dropped ${badLines} malformed event line(s)`);
      }
      sessions.push({ dir, meta, events });
    } catch {
      // skip unreadable session dirs
    }
  }
  return sessions;
}

export function generateAggregate(dirs: string[]): string {
  const sessions = loadSessions(dirs);
  if (sessions.length === 0) {
    return "# Aggregate Report\n\nNo valid sessions found.\n";
  }

  const lines: string[] = [];
  lines.push(`# Aggregate Funnel Report`);
  lines.push("");
  lines.push(`- **Sessions:** ${sessions.length}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // verdict summary
  const byKind = { completed: 0, abandoned: 0, guardrail: 0 };
  for (const s of sessions) byKind[s.meta.exit.kind]++;
  lines.push(`## Verdict Summary`);
  lines.push("");
  lines.push(`| Outcome | Count |`);
  lines.push(`|---------|-------|`);
  lines.push(`| ✅ Completed | ${byKind.completed} |`);
  lines.push(`| ❌ Abandoned | ${byKind.abandoned} |`);
  lines.push(`| ⚠️ Guardrail | ${byKind.guardrail} |`);
  lines.push("");

  // per-persona breakdown
  lines.push(`## By Persona`);
  lines.push("");
  lines.push(`| Persona | Runs | Completed | Abandoned | Avg Confusion | Avg Steps |`);
  lines.push(`|---------|------|-----------|-----------|---------------|-----------|`);
  const personas = new Set(sessions.map((s) => s.meta.personaId));
  for (const pid of personas) {
    const runs = sessions.filter((s) => s.meta.personaId === pid);
    const name = PERSONAS[pid]?.name ?? pid;
    const completed = runs.filter((r) => r.meta.exit.kind === "completed").length;
    const avgConf =
      runs.reduce((a, r) => a + (r.events.at(-1)?.decision.confusion ?? 0), 0) /
      runs.length;
    lines.push(
      `| ${name} (${pid}) | ${runs.length} | ${completed} | ${runs.length - completed} | ${(avgConf).toFixed(1)}/10 | ${(runs.reduce((a, r) => a + r.events.length, 0) / runs.length).toFixed(1)} |`,
    );
  }
  lines.push("");

  // per-session table
  lines.push(`## Session Detail`);
  lines.push("");
  lines.push(`| Session | Persona | Verdict | Steps | Time | Drop Point | Reason |`);
  lines.push(`|---------|---------|---------|-------|------|------------|--------|`);
  for (const s of [...sessions].sort((a, b) => a.dir.localeCompare(b.dir))) {
    const last = s.events.at(-1);
    const drop =
      s.meta.exit.kind === "abandoned"
        ? `step ${last?.n} on ${shortUrl(last?.url ?? "")}`
        : "—";
    const reason =
      s.meta.exit.kind === "abandoned"
        ? s.meta.exit.reason
        : s.meta.exit.kind === "completed"
          ? s.meta.exit.summary
          : s.meta.exit.detail;
    lines.push(
      `| \`${dirName(s.dir)}\` | ${PERSONAS[s.meta.personaId]?.name ?? s.meta.personaId} | ${verdictIcon(s.meta.exit)} | ${s.events.length} | ${journeySeconds(s.events) === null ? "—" : fmtDuration(journeySeconds(s.events)!)} | ${drop} | ${cell(reason)} |`,
    );
  }
  lines.push("");

  // common drop pages
  const dropPages = new Map<string, number>();
  for (const s of sessions) {
    if (s.meta.exit.kind !== "abandoned") continue;
    const u = shortUrl(s.events.at(-1)?.url ?? "");
    dropPages.set(u, (dropPages.get(u) ?? 0) + 1);
  }
  if (dropPages.size > 0) {
    lines.push(`## Most Common Drop Points`);
    lines.push("");
    for (const [page, count] of [...dropPages.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${page}\` — ${count} persona(s) walked out here`);
    }
    lines.push("");
  }

  // verbatim wall of complaints
  const quotes = sessions
    .filter((s) => s.meta.exit.kind === "abandoned")
    .map((s) => `- "${(s.meta.exit as { reason: string }).reason}"`);
  if (quotes.length > 0) {
    lines.push(`## Why They Left (verbatim)`);
    lines.push("");
    lines.push(...quotes);
    lines.push("");
  }

  return lines.join("\n");
}

function verdictIcon(exit: ExitReason): string {
  switch (exit.kind) {
    case "completed":
      return "✅ completed";
    case "abandoned":
      return "❌ abandoned";
    case "guardrail":
      return "⚠️ guardrail";
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

/** Within a per-site report the site is implicit, so show <date>/<run>. */
function dirName(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || dir;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
}
