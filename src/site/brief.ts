/**
 * The site brief — `runs/<site>/SITE.md`.
 *
 * Written once per site, before any prospect is sent. Its main job is the ICP:
 * persona generation cannot build a set that fits a product it has not read.
 * Its other readers are you, and — rationed by temperature — the personas.
 *
 * The expert panel does NOT read it yet. It arguably should: the panel currently
 * reviews a transcript without knowing what the site was trying to sell.
 *
 * How much of it a persona sees is the whole design (see `arrivalFor`). Handing
 * a cold persona a summary of the page destroys the signal cold personas exist
 * to produce.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Brain } from "../types.js";
import { extractJson } from "../brain/adapters/cli-brain.js";
import { scrapeSiteContext } from "../persona/generate.js";
import { RUNS_ROOT, siteSlug } from "../runs.js";

const BriefSchema = z.object({
  product: z.string().min(1).max(300),
  audience: z.string().min(1).max(300),
  cta: z.string().min(1).max(300),
  signup: z.string().min(1).max(300),
  pricing: z.string().min(1).max(300),
  walls: z.array(z.string().min(1).max(200)).max(8).default([]),
  tripwires: z.array(z.string().min(1).max(300)).max(8).default([]),
  /** What a visitor plausibly believed BEFORE clicking through. Warm and hot only. */
  arrival: z.string().min(1).max(600),
});

export type SiteBrief = z.infer<typeof BriefSchema>;

export function briefPath(url: string): string {
  return `${RUNS_ROOT}/${siteSlug(url)}/SITE.md`;
}

/**
 * Bot-wall detection — the site brief's scrape doubles as a one-agent scout.
 *
 * A Cloudflare interstitial or a captcha means every persona would burn its
 * whole patience against the same wall and file ten identical guardrails, so a
 * blocked site is marked once (`runs/<site>/BLOCKED.md`) and skipped until the
 * marker is deleted or `--plan` re-checks.
 */
const BOT_WALLS: [RegExp, string][] = [
  [/just a moment/i, "Cloudflare interstitial (“Just a moment…”)"],
  [/checking your browser|enable javascript and cookies to continue/i, "Cloudflare browser check"],
  [/attention required!?\s*\|?\s*cloudflare/i, "Cloudflare block page"],
  [/verify(ing)? (that )?you are (a )?human/i, "human-verification wall"],
  [/are you a robot/i, "robot check"],
  [/h?captcha|recaptcha/i, "captcha"],
  [/press & hold|press and hold to confirm/i, "PerimeterX press-and-hold"],
  [/ddos-guard/i, "DDoS-Guard"],
];

/** The wall a page's text shows, or null when it reads as a normal page. */
export function botWallMarker(pageText: string): string | null {
  for (const [re, label] of BOT_WALLS) if (re.test(pageText)) return label;
  return null;
}

export function blockedPath(url: string): string {
  return `${RUNS_ROOT}/${siteSlug(url)}/BLOCKED.md`;
}

/** Why this site is marked blocked, or null. Delete BLOCKED.md to retry. */
export function blockedReason(url: string): string | null {
  const path = blockedPath(url);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").match(/^> (.+)$/m)?.[1] ?? "bot wall";
  } catch {
    return "bot wall";
  }
}

function markBlocked(url: string, reason: string): void {
  const path = blockedPath(url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `# ${siteSlug(url)} — blocked\n\n> ${reason}\n\nDetected ${new Date().toISOString().slice(0, 10)} by the scout scrape. Personas cannot get\npast this wall, so runs skip this site. Delete this file (or pass --plan) to re-check.\n`,
  );
}

export function hasBrief(url: string): boolean {
  return existsSync(briefPath(url));
}

/** The whole brief as markdown, for prompts and for printing. Null if never written. */
export function loadBrief(url: string): string | null {
  const path = briefPath(url);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The `| **Product** | ... |` rows of the brief, back as a lookup. */
function fields(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    const m = line.match(/^\| \*\*(.+?)\*\* \| (.+?) \|$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * The ICP seed for persona generation: who this is for, and what it is.
 *
 * Reading the page is what makes a persona set fit the product rather than
 * fitting "a website", so this is the brief's main job — the arrival context is
 * a by-product.
 */
export function icpSeed(url: string): string | null {
  const md = loadBrief(url);
  if (!md) return null;
  const f = fields(md);
  if (!f.for) return null;
  return f.product ? `${f.for} (product: ${f.product})` : f.for;
}

/** The arrival paragraph on its own. */
export function loadArrivalContext(url: string): string | null {
  const md = loadBrief(url);
  if (!md) return null;
  const m = md.match(/## Arrival context\n+([\s\S]*?)(?:\n## |\n<!--|$)/);
  const text = m?.[1]?.trim();
  return text || null;
}

/**
 * How much of the brief a persona arrives holding, rationed by temperature.
 *
 * The temperatures are not three flavours of the same visitor — they are three
 * different amounts of prior research, and that is most of what makes them
 * behave differently:
 *
 *   cold  nothing. Never heard of it, clicked something and landed here. Handing
 *         this persona any of the brief turns it into a warm one, and whatever
 *         it then fails to notice is no longer evidence about the page.
 *   warm  the arrival paragraph. Has heard of the product and is comparing it
 *         against something else, so it knows what it came for but not the
 *         specifics.
 *   hot   the arrival paragraph plus what a decided buyer would already have
 *         looked up — what it does, what it costs, how signup works. This
 *         persona is here to convert, and a hot prospect rediscovering the
 *         pricing page is not a real hot prospect.
 */
export function arrivalFor(url: string, temperature: "cold" | "warm" | "hot"): string | null {
  if (temperature === "cold") return null;

  const md = loadBrief(url);
  if (!md) return null;
  const arrival = loadArrivalContext(url);
  if (!arrival) return null;
  if (temperature === "warm") return arrival;

  const f = fields(md);
  const known = (
    [
      ["What it does", f.product],
      ["What it costs", f.pricing],
      ["How you sign up", f.signup],
    ] as const
  ).filter(([, v]) => v);

  if (known.length === 0) return arrival;
  return `${arrival}\n\nYou already looked this up before coming:\n${known
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n")}`;
}

function render(url: string, b: SiteBrief): string {
  const list = (items: string[], empty: string) =>
    items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;

  return `# ${siteSlug(url)}

${url}

| | |
|---|---|
| **Product** | ${b.product} |
| **For** | ${b.audience} |
| **Main CTA** | ${b.cta} |
| **Signup** | ${b.signup} |
| **Pricing** | ${b.pricing} |

## Walls

${list(b.walls, "none found on the landing page")}

## What a first-timer trips on

${list(b.tripwires, "nothing obvious")}

## Arrival context

${b.arrival}

<!-- Written by client-simulator from the live page. Regenerate with --plan. -->
`;
}

const PROMPT = (url: string, context: string) =>
  `You are briefing a user-testing team before they send prospects through this site.

PAGE (accessibility snapshot of ${url}):
${context}

Answer only from what is actually on the page. Be concrete and short. Where
something genuinely is not on the page, say so plainly instead of guessing —
"not visible on the landing page" is a useful answer.

"arrival" is different from the rest: it is what a visitor who had already heard
of this plausibly believed BEFORE clicking through — the search they ran, the
claim that brought them, what they hope to find. Write it in second person, two
or three sentences. Do NOT describe the page itself there; the reader is standing
outside the door.

Reply ONLY with this JSON object:
{
  "product": "what this sells, in plain words",
  "audience": "who it appears to be for",
  "cta": "the primary action the page pushes, and where it leads",
  "signup": "how someone actually gets an account, and at what path",
  "pricing": "what pricing is visible, or that none is",
  "walls": ["things that block progress: SSO, payment, email verification, waitlist"],
  "tripwires": ["what a first-time visitor would trip on or misread"],
  "arrival": "what you were looking for when you clicked through, in second person"
}`;

/**
 * Make sure `runs/<site>/SITE.md` exists, writing it if it does not.
 *
 * Returns the markdown, or null if the page could not be read — a brief is
 * worth having, never worth blocking a run over.
 */
export async function ensureBrief(
  url: string,
  brain: Brain & { ask?(prompt: string): Promise<string> },
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (!opts.force) {
    const existing = loadBrief(url);
    if (existing) return existing;
  }
  if (!brain.ask) return null;

  const context = await scrapeSiteContext(url).catch(() => "");
  if (!context) return null;

  const wall = botWallMarker(context);
  if (wall) {
    markBlocked(url, wall);
    return null;
  }

  let brief: SiteBrief;
  try {
    const json = extractJson(await brain.ask(PROMPT(url, context)));
    if (!json) return null;
    const parsed = BriefSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    brief = parsed.data;
  } catch {
    return null;
  }

  const md = render(url, brief);
  const path = briefPath(url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, md);
  return md;
}
