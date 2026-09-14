/**
 * Mechanical page checks — facts a ruler can measure, next to what a persona
 * felt. A persona says "I couldn't tap it"; this says "28×28px, minimum is 24".
 * Pure functions over the accessibility snapshot and the rects `measure()`
 * already collects, so they cost nothing and cannot invent.
 */

export interface PageAudit {
  /** interactive controls the tree exposes with no accessible name */
  unnamed: string[];
  /** visible interactive controls smaller than MIN_TARGET_PX on a side */
  small: string[];
  /** the document is wider than the viewport — a sideways scroll on phones */
  overflowX: boolean;
  /** `<meta name="viewport">` present; without it phones render the desktop page */
  viewportMeta: boolean;
}

/** WCAG 2.5.8 minimum target size. ponytail: 44 is the mobile guideline; add when --mobile audits matter. */
export const MIN_TARGET_PX = 24;

const CONTROL = /^\s*-\s*(button|link|textbox|checkbox|radio|combobox|switch|tab|menuitem|slider|searchbox)\b(?:\s+"([^"]*)")?[^[]*\[ref=((?:f\d+)?e\d+)\]/;

/** Every interactive control in the snapshot: role, ref and accessible name ("" when none). */
export function controls(ariaYaml: string): { role: string; ref: string; name: string }[] {
  const out: { role: string; ref: string; name: string }[] = [];
  for (const line of ariaYaml.split("\n")) {
    const m = line.match(CONTROL);
    if (m) out.push({ role: m[1], ref: m[3], name: (m[2] ?? "").trim() });
  }
  return out;
}

export function unnamedControls(ariaYaml: string, sizes: Record<string, { hidden?: boolean }> = {}): string[] {
  // a closed menu's toggle is in the tree but not on the page — no finding
  return controls(ariaYaml).filter((c) => !c.name && !sizes[c.ref]?.hidden).map((c) => c.ref);
}

export function smallTargets(
  ariaYaml: string,
  sizes: Record<string, { w?: number; h?: number; hidden?: boolean }>,
  min = MIN_TARGET_PX,
): string[] {
  // WCAG 2.5.8 exempts links inline in text, and most links are; buttons and fields are the targets that matter
  return controls(ariaYaml)
    .filter(({ role, ref }) => {
      if (role === "link") return false;
      const s = sizes[ref];
      return s && !s.hidden && s.w !== undefined && s.h !== undefined && s.w > 0 && s.h > 0 && (s.w < min || s.h < min);
    })
    .map((c) => c.ref);
}
