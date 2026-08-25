/**
 * Run-directory layout: runs/<site>/<YYYY-MM-DD>/<HH-MM-SS>-<persona>/
 *
 * Kept in its own module rather than in cli.ts so it can be imported — and
 * tested — without executing the CLI's main().
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const RUNS_ROOT = "runs";

/**
 * Folder name for a target site: host minus www., filesystem-safe.
 * The port is kept, so localhost:3000 and localhost:8080 stay separate.
 */
export function siteSlug(url: string): string {
  try {
    const host = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).host;
    const slug = host.replace(/^www\./, "").replace(/[^a-zA-Z0-9._-]/g, "_");
    // "." and ".." survive the character filter but would escape runs/
    return !slug || /^\.+$/.test(slug) ? "unknown-site" : slug;
  } catch {
    return "unknown-site";
  }
}

/**
 * Where a new session's artifacts go. Two runs of the same persona within one
 * second get a numeric suffix rather than overwriting each other.
 */
export function sessionPath(
  url: string,
  personaId: string,
  now: Date = new Date(),
  root: string = RUNS_ROOT,
): string {
  const iso = now.toISOString();
  const base = resolve(`${root}/${siteSlug(url)}/${iso.slice(0, 10)}`);
  const time = iso.slice(11, 19).replace(/:/g, "-");
  let dir = `${base}/${time}-${personaId}`;
  for (let n = 2; existsSync(dir); n++) dir = `${base}/${time}-${personaId}-${n}`;
  return dir;
}

/**
 * Every session directory under the runs root, at any depth.
 *
 * Identity is "contains a meta.json", not position, so the nesting is not
 * load-bearing — sites can be reorganised into subfolders and stages 2-3 still
 * find everything.
 */
export function findSessionDirs(root: string = RUNS_ROOT): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "shots") continue;
      const child = `${dir}/${entry.name}`;
      if (existsSync(`${child}/meta.json`)) found.push(resolve(child));
      else walk(child);
    }
  };
  walk(root);
  return found.sort();
}

/** Session identity for humans: <site>/<date>/<time-persona>, relative to runs/. */
export function dirLabel(dir: string): string {
  const parts = resolve(dir).split("/").filter(Boolean);
  const i = parts.lastIndexOf(RUNS_ROOT);
  return i >= 0 ? parts.slice(i + 1).join("/") : (parts.pop() ?? dir);
}
