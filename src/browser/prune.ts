/**
 * Remove machine-only noise from a page snapshot.
 *
 * A snapshot is the text a persona sees each step, and on a citation-heavy page
 * a sixth of it is metadata blobs no human could read — COinS strings,
 * percent-encoded payloads, key=value&key=value junk. Dropping those is free:
 * a visitor could not have perceived them in the first place.
 *
 * Deliberately narrow. Two other rules were tried and removed:
 *   - truncating long text deleted the tail of consent copy, which is where
 *     "your card will be charged $49/month" lives — the exact thing personas
 *     exist to notice (see presets.ts: "gets annoyed by vague pricing").
 *   - dropping #fragment link targets anonymised links whose only identity was
 *     that fragment, leaving controls the persona cannot tell apart.
 * Together they saved ~7% of one pathological page and 0% of every other page,
 * while carrying all of the risk. Not worth it.
 */

const REF = /\[ref=e\d+\]/;

/**
 * Citation blobs (COinS), percent-encoded payloads and query-string soup.
 * Matched only on `generic` nodes, which carry no accessible name and so
 * cannot be a control a persona would act on.
 */
const MACHINE_NOISE = /(%[0-9A-F]{2}|&rft|ctx_ver|=[^\s"]*&[^\s"]*=)/;

export function pruneSnapshot(ariaYaml: string): string {
  return ariaYaml
    .split("\n")
    .filter((line) => {
      // never drop a line carrying something the persona can act on, whatever
      // else it looks like
      if (REF.test(line)) return true;
      return !(/^\s*-?\s*generic /.test(line) && MACHINE_NOISE.test(line));
    })
    .join("\n");
}
