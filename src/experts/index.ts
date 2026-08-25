import type { Expert } from "./types.js";
import { uxExpert } from "./ux.js";
import { scoresExpert } from "./scores.js";
import { copywriterExpert } from "./copywriter.js";
import { trustExpert, accessibilityExpert } from "./reviewers.js";
import { slopExpert, seoExpert } from "./discoverability.js";

/**
 * Registry of specialist agents run by `client-sim fix <session-dir>`.
 * Add a new expert here and it automatically joins the panel.
 */
export const EXPERTS: Expert[] = [
  scoresExpert,
  uxExpert,
  copywriterExpert,
  trustExpert,
  accessibilityExpert,
  slopExpert,
  seoExpert,
];
