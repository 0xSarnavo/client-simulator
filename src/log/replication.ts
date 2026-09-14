import { existsSync, readFileSync } from "node:fs";

/**
 * Replication analysis — the escalation ladder's filter.
 *
 * Across every sweep to date, the single most reliable quality signal was
 * replication: independent sessions citing the same element ref. Every
 * catalogued hallucination was single-source; no replicated finding was one.
 * This module makes that check mechanical: extract element refs from what a
 * session recorded (expert findings, the persona's own trail), group by
 * (site, ref), and count how many distinct models and sessions each was
 * seen by. Findings marked `single-source` are where fabrication lives;
 * `replicated N×` is what earns escalation to a stronger model.
 */

/**
 * Element refs as the snapshot prints them: `e42` main-frame, `f5e27` framed.
 * Framed refs matter — signup forms are routinely iframed, and the sweep's
 * headline finding (site-c's unlabeled buttons) lives at f1e33/f1e66/f1e99.
 * The word boundary keeps prose like "female" or "See27" out.
 */
const REF_PATTERN = /\b(f\d+e\d+|e\d{1,4})\b/g;

/** Refs that appear in text but are not element refs on any page. */
const REF_NOISE = new Set(["e2e"]);

export function extractRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const m of text.matchAll(REF_PATTERN)) {
    if (!REF_NOISE.has(m[1])) refs.add(m[1]);
  }
  return refs;
}

export interface RefSighting {
  ref: string;
  /** hostname the session ran against (www. stripped) */
  site: string;
  sessionDir: string;
  model: string;
  /** which artifact cited it: the expert panel or the persona's own trail */
  source: "fixes" | "trail";
}

export interface ReplicationRow {
  site: string;
  ref: string;
  models: string[];
  sessions: number;
  /** cited by an expert report (not only passed through in a snapshot) */
  inFindings: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Scan session directories for ref sightings.
 *
 * FIXES.md is the strong signal: an expert chose to cite that ref in a
 * finding. session.jsonl thoughts are the weak signal: the persona mentioned
 * it while browsing. Snapshots themselves are deliberately NOT scanned —
 * every ref on a visited page appears there, which would make every ref
 * "replicated" by every session that loaded the page.
 */
export function collectSightings(dirs: string[]): RefSighting[] {
  const sightings: RefSighting[] = [];
  for (const dir of dirs) {
    const metaPath = `${dir}/meta.json`;
    if (!existsSync(metaPath)) continue;
    let meta: { url?: string; model?: string | null };
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    const site = hostOf(meta.url ?? "");
    const model = meta.model ?? "unknown";

    const fixesPath = `${dir}/FIXES.md`;
    if (existsSync(fixesPath)) {
      for (const ref of extractRefs(readFileSync(fixesPath, "utf8"))) {
        sightings.push({ ref, site, sessionDir: dir, model, source: "fixes" });
      }
    }

    const jsonlPath = `${dir}/session.jsonl`;
    if (existsSync(jsonlPath)) {
      for (const line of readFileSync(jsonlPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as {
            decision?: { thought?: string; action?: { target?: string } };
            note?: string;
          };
          // action.target is the strongest trail signal: the persona actually
          // acted on that ref, not merely mentioned it in a thought.
          const text = `${event.decision?.thought ?? ""} ${event.decision?.action?.target ?? ""} ${event.note ?? ""}`;
          for (const ref of extractRefs(text)) {
            sightings.push({ ref, site, sessionDir: dir, model, source: "trail" });
          }
        } catch {
          /* one bad line never kills the scan */
        }
      }
    }
  }
  return sightings;
}

/** Group sightings into per-(site, ref) replication rows, strongest first. */
export function replicationTable(sightings: RefSighting[]): ReplicationRow[] {
  const byKey = new Map<string, RefSighting[]>();
  for (const s of sightings) {
    const key = `${s.site}${s.ref}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  const rows: ReplicationRow[] = [];
  for (const list of byKey.values()) {
    rows.push({
      site: list[0].site,
      ref: list[0].ref,
      models: [...new Set(list.map((s) => s.model))].sort(),
      sessions: new Set(list.map((s) => s.sessionDir)).size,
      inFindings: list.some((s) => s.source === "fixes"),
    });
  }
  // strongest replication first: distinct models, then session count
  rows.sort((a, b) => b.models.length - a.models.length || b.sessions - a.sessions);
  return rows;
}

export function renderReplication(rows: ReplicationRow[]): string {
  const lines = [
    "# Replication",
    "",
    "Element refs cited across sessions, grouped by site. `replicated N models`",
    "is the ladder's escalation signal; `single-source` is where fabricated",
    "findings live — treat those as unverified until a second session cites them.",
    "",
    "| site | ref | verdict | models | sessions | in findings |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const verdict =
      r.models.length > 1 ? `replicated ${r.models.length} models` : "single-source";
    lines.push(
      `| ${r.site} | \`${r.ref}\` | ${verdict} | ${r.models.join(", ")} | ${r.sessions} | ${r.inFindings ? "yes" : "trail only"} |`,
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * The sessions worth a verifier's time: those citing the most refs that other
 * sessions also cite. A session full of single-source refs ranks last.
 */
export function topSessions(sightings: RefSighting[], rows: ReplicationRow[], n = 3): string[] {
  const replicated = new Set(rows.filter((r) => r.sessions >= 2).map((r) => `${r.site}${r.ref}`));
  const score = new Map<string, number>();
  for (const s of sightings) {
    if (!replicated.has(`${s.site}${s.ref}`)) continue;
    score.set(s.sessionDir, (score.get(s.sessionDir) ?? 0) + 1);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([d]) => d);
}
