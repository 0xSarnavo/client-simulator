/**
 * Real-visitor numbers for a site — `runs/<site>/analytics.json`, written by
 * hand or by a connector later. Persona generation reads it as context, so
 * the invented prospects arrive the way real ones do: from the same places,
 * on the same devices, leaving at the same pages. Optional; absent means
 * fully synthetic, which is the default.
 *
 * Kept tiny on purpose: five lines from a founder's dashboard is the whole
 * input, and that is all the calibration test (Q6) needs.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { RUNS_ROOT, siteSlug } from "../runs.js";
import { fenceSafe } from "../brain/prompt.js";

const Share = z.number().min(0).max(1);
export const AnalyticsSchema = z.object({
  /** where real visitors leave, biggest first; share is of all exits (0-1) */
  exitPages: z.array(z.object({ path: z.string().min(1), share: Share })).max(20).default([]),
  /** device mix, e.g. { mobile: 0.55, desktop: 0.45 } */
  devices: z.record(Share).default({}),
  /** where visitors come from, e.g. ["google organic", "product hunt"] */
  entry: z.array(z.string().min(1)).max(10).default([]),
  /** anything else the owner knows, one paragraph */
  note: z.string().max(600).optional(),
});
export type Analytics = z.infer<typeof AnalyticsSchema>;

export function analyticsPath(url: string): string {
  return `${RUNS_ROOT}/${siteSlug(url)}/analytics.json`;
}

/** The file if present and valid; null if absent; throws on a malformed file (the owner wrote it, so say so). */
export function loadAnalytics(url: string): Analytics | null {
  const p = analyticsPath(url);
  if (!existsSync(p)) return null;
  const res = AnalyticsSchema.safeParse(JSON.parse(readFileSync(p, "utf8")));
  if (!res.success) throw new Error(`${p}: ${res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return res.data;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The prompt block persona generation gets. Plain sentences; numbers as given. */
export function renderAnalytics(a: Analytics): string {
  const lines: string[] = [];
  if (a.exitPages.length) lines.push(`Where real visitors leave: ${a.exitPages.map((e) => `${e.path} (${pct(e.share)})`).join(", ")}.`);
  const devices = Object.entries(a.devices);
  if (devices.length) lines.push(`Devices: ${devices.map(([d, s]) => `${d} ${pct(s)}`).join(", ")}.`);
  if (a.entry.length) lines.push(`They arrive from: ${a.entry.join(", ")}.`);
  if (a.note) lines.push(a.note);
  return fenceSafe(lines.join("\n"));
}
