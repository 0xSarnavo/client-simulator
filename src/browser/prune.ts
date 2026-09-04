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

/**
 * A ref id. Elements inside an iframe carry a frame prefix — `f5e27`, not `e27`
 * — and firecrawl.dev's signup form is one, so a pattern that only matches `eN`
 * silently ignores every control a persona has to use to sign up.
 */
const REF_ID_PATTERN = String.raw`(?:f\d+)?e\d+`;
const REF = new RegExp(String.raw`\[ref=${REF_ID_PATTERN}\]`);

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

/** Just the visibility facts this module needs — see driver.ts RefVisibility. */
export interface Visibility {
  hidden: boolean;
  belowFold: boolean;
  onScreen: boolean;
}

export interface ViewportSplit {
  /** the subtree a person can actually see, same YAML shape as the input */
  visible: string;
  /** headings and named controls further down the page, as a flat list */
  below: string[];
  dropped: { hidden: number; below: number };
}

const REF_ID = new RegExp(String.raw`\[ref=(${REF_ID_PATTERN})\]`);
const INDENT = /^(\s*)/;
/** Roles worth naming in the "further down" outline — landmarks a person scans for. */
const OUTLINE_ROLE = /^\s*-\s*(heading|button|link|tab|region|form)\b/;
const MAX_OUTLINE = 15;

/**
 * Split a snapshot into what is on screen and an outline of what is further down.
 *
 * The accessibility tree is the whole document, so a persona reading it perceives
 * 21 screens at once while the person it is imitating perceives one. That is not
 * a small distortion: on firecrawl.dev it is 776 refs against 37 a visitor could
 * see, and it lets a persona click a footer link at step 1 without ever scrolling.
 *
 * A node survives when it, or anything under it, is on screen — dropping a parent
 * while keeping its children would break the indentation the tree is made of.
 * What is below the fold comes back as a flat outline rather than vanishing: a
 * person can see that a page continues, and scroll toward a heading on purpose.
 */
export function splitByViewport(
  ariaYaml: string,
  visibility: Record<string, Visibility>,
): ViewportSplit {
  const lines = ariaYaml.split("\n");
  // nothing measured (older snapshot, or the capture failed) — change nothing
  if (Object.keys(visibility).length === 0) {
    return { visible: ariaYaml, below: [], dropped: { hidden: 0, below: 0 } };
  }

  const indentOf = (l: string) => (l.match(INDENT)?.[1].length ?? 0);
  const visOf = (l: string) => {
    const id = l.match(REF_ID)?.[1];
    return id ? visibility[id] : undefined;
  };

  // a line is kept when it is visible itself, or is an ancestor of something that is
  const keep = new Array<boolean>(lines.length).fill(false);
  const dropped = { hidden: 0, below: 0 };

  for (let i = 0; i < lines.length; i++) {
    const v = visOf(lines[i]);
    if (v?.hidden) {
      dropped.hidden++;
      continue;
    }
    // an unref'd structural line is kept only if a kept descendant needs it
    if (!v) continue;
    if (!v.onScreen) {
      dropped.below++;
      continue;
    }
    keep[i] = true;
    // walk outward to the root so the indentation stays parseable
    for (let j = i - 1, depth = indentOf(lines[i]); j >= 0 && depth > 0; j--) {
      const d = indentOf(lines[j]);
      if (d < depth && lines[j].trim()) {
        keep[j] = true;
        depth = d;
      }
    }
  }

  /**
   * Headings first, then everything else, each in document order.
   *
   * Taking the first N in pure document order fills the whole outline from
   * whichever section happens to sit just under the fold — on firecrawl.dev that
   * was fifteen buttons of one demo widget, and "Pricing" further down never
   * appeared. Headings are what a person skimming a long page actually navigates
   * by, so they get the slots first.
   */
  const clean = (l: string) =>
    l
      .trim()
      .replace(/^-\s*/, "")
      .replace(new RegExp(String.raw`\s*\[ref=${REF_ID_PATTERN}\]`), "")
      .replace(/:$/, "");

  const headings: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) continue;
    const v = visOf(lines[i]);
    if (!v || v.hidden || !v.belowFold) continue;
    if (!OUTLINE_ROLE.test(lines[i])) continue;
    // refs are omitted on purpose: you cannot click what you have not scrolled to
    (/^\s*-\s*heading\b/.test(lines[i]) ? headings : rest).push(clean(lines[i]));
  }
  const below = [...headings, ...rest].slice(0, MAX_OUTLINE);

  return { visible: lines.filter((_, i) => keep[i]).join("\n"), below, dropped };
}
