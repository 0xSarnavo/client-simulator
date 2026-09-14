/**
 * The site map — `runs/<site>/map.json` and its rendering `MAP.md`.
 *
 * A crawler's view of the site: every internal page reachable within two
 * clicks of the landing page plus whatever sitemap.xml lists, each tagged with
 * what kind of page it is. Personas never see it. It exists so the aggregate
 * can answer two questions a session cannot: which pages exist that no
 * prospect ever found, and which booking or payment surfaces are on the site
 * (the guards refuse the commit, so a persona reaching one is the finding).
 *
 * A crawler follows `href`; a persona sees one viewport and has to scroll. The
 * gap between the two is the point, not a defect in either.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RUNS_ROOT, siteSlug } from "../runs.js";

export type PageKind =
  | "booking"
  | "payment"
  | "auth"
  | "app"
  | "pricing"
  | "legal"
  | "docs"
  | "blog"
  | "marketing";

export interface MappedPage {
  url: string;
  kind: PageKind;
  title: string;
  /** clicks from the landing page; -1 for sitemap-only entries */
  depth: number;
  /** off-site booking/payment surfaces are recorded but never crawled */
  external: boolean;
}

export interface SiteMap {
  url: string;
  generated: string;
  pages: MappedPage[];
}

export const MAX_PAGES = 200;
export const MAX_DEPTH = 2;
/** whole-crawl ceiling; a slow site gets a partial map, not a stalled run */
export const MAX_CRAWL_MS = 3 * 60_000;
const PAGE_MS = 20_000;

/** Ordered: the first pattern that matches wins, so a checkout on app.* is payment, not app. */
const KINDS: [PageKind, RegExp][] = [
  ["booking", /cal\.com|calendly\.com|savvycal|chilipiper|meetings\.hubspot|\/((book|schedule)([-_]?a)?[-_]?(demo|call|meeting)?|demo)(\/|$|\?)/i],
  ["payment", /checkout\.stripe\.com|paddle\.com|lemonsqueezy|\/(checkout|billing|pay|purchase|cart|subscribe|upgrade)(\/|$|\?)/i],
  ["auth", /\/(login|log-in|signin|sign-in|signup|sign-up|register|auth|onboard(ing)?|verify|reset-password|forgot)(\/|$|\?)/i],
  ["app", /^https?:\/\/(app|console|dashboard|studio|platform|my)\.|\/(app|dashboard|console|workspace|settings)(\/|$|\?)/i],
  ["pricing", /\/(pricing|plans)(\/|$|\?)/i],
  ["legal", /\/(privacy|terms|tos|security|trust|legal|dpa|compliance|cookies?|gdpr)(\/|$|\?)/i],
  ["docs", /^https?:\/\/docs?\.|\/(docs?|documentation|api-reference|reference|guides?|tutorials?|help|support)(\/|$|\?)/i],
  ["blog", /\/(blog|changelog|news|posts?|articles?|careers|jobs|customers|case-studies)(\/|$|\?)/i],
];

export function classify(url: string): PageKind {
  // a docs page about billing is documentation, not a checkout — the URL
  // blocklist once killed sessions on exactly this confusion (DECISIONS 2026-08-26)
  if (/^https?:\/\/docs?\.|\/docs?\//i.test(url)) return "docs";
  for (const [kind, re] of KINDS) if (re.test(url)) return kind;
  return "marketing";
}

/**
 * The root host or a subdomain of it: app.example.com is example.com's.
 * Not "last two labels" — that made every *.co.uk one site.
 * ponytail: a root given as app.example.com does not see docs.example.com; pass the apex.
 */
export function sameSite(root: string, candidate: string): boolean {
  try {
    const rh = new URL(root).hostname.replace(/^www\./, "");
    const c = new URL(candidate);
    if (!/^https?:$/.test(c.protocol)) return false;
    const ch = c.hostname.replace(/^www\./, "");
    return ch === rh || ch.endsWith(`.${rh}`);
  } catch {
    return false;
  }
}

const SKIP_EXT = /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|gz|tar|mp4|webm|mp3|css|js|json|xml|txt|woff2?|ttf)(\?|$)/i;

/** One spelling per page: no hash, no trailing slash, lower-case host. Keeps www — this is also the URL fetched. */
export function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (u.pathname.length > 1 && u.pathname.endsWith("/") && !u.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return url;
  }
}

/** Compare by host + path only — a persona reaching /pricing?ref=nav has reached /pricing. */
function pageKey(url: string): string {
  try {
    const u = new URL(normalize(url));
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** `<loc>` entries of a sitemap or sitemap index. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/**
 * Pages the crawler could open only to find a 404, or could not reach at all.
 * A page that merely took too long to render is "(slow …)", not broken —
 * calling a slow docs page a dead link was a false positive waiting to happen.
 */
export function broken(map: SiteMap): MappedPage[] {
  return map.pages.filter((p) => !p.external && /\b404\b|not found|unreachable|^HTTP [45]\d\d/i.test(p.title));
}

/** Mapped pages no session ever landed on, in map order. */
export function unreached(map: SiteMap, reachedUrls: string[]): MappedPage[] {
  const seen = new Set(reachedUrls.map(pageKey));
  return map.pages.filter((p) => !p.external && !seen.has(pageKey(p.url)));
}

/** Mapped booking/payment surfaces, each with whether any session reached it. */
export function guardedSurfaces(
  map: SiteMap,
  reachedUrls: string[],
): { page: MappedPage; reached: boolean }[] {
  const seen = new Set(reachedUrls.map(pageKey));
  return map.pages
    .filter((p) => p.kind === "booking" || p.kind === "payment")
    .map((page) => ({ page, reached: seen.has(pageKey(page.url)) }));
}

export function mapPath(url: string): string {
  return `${RUNS_ROOT}/${siteSlug(url)}/map.json`;
}

export function loadMap(url: string): SiteMap | null {
  const p = mapPath(url);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SiteMap;
  } catch {
    return null;
  }
}

export function renderMap(map: SiteMap): string {
  const counts = new Map<PageKind, number>();
  for (const p of map.pages) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  const lines = [
    `# Site map — ${siteSlug(map.url)}`,
    "",
    `${map.pages.length} pages reachable by link (${MAX_DEPTH} clicks) or sitemap from ${map.url}. Generated ${map.generated}.`,
    "",
    `| Kind | Pages |`,
    `|---|---|`,
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    "",
  ];
  const guarded = map.pages.filter((p) => p.kind === "booking" || p.kind === "payment");
  if (guarded.length) {
    lines.push(`## Booking and payment surfaces`, "");
    lines.push(`Personas may open these; the commit control on each is refused by the guard.`, "");
    for (const p of guarded) lines.push(`- ${p.kind}: ${p.url}${p.external ? " (off-site)" : ""}`);
    lines.push("");
  }
  const dead = broken(map);
  if (dead.length) {
    lines.push(`## Broken links`, "");
    lines.push(`Linked from the site, but the crawler got a 404 or no page at all.`, "");
    for (const p of dead) lines.push(`- ${p.url} — ${p.title}`);
    lines.push("");
  }
  lines.push(`## Pages`, "", `| URL | Kind | Depth | Title |`, `|---|---|---|---|`);
  for (const p of map.pages) {
    lines.push(
      `| ${p.url} | ${p.kind} | ${p.depth < 0 ? "sitemap" : p.depth} | ${p.title.replace(/\|/g, "\\|").slice(0, 80)} |`,
    );
  }
  lines.push("", `<!-- Written by leakdown. Regenerate with --plan. -->`, "");
  return lines.join("\n");
}

/**
 * Crawl: breadth-first from the landing page, same site only, MAX_DEPTH
 * clicks, MAX_PAGES pages. Sitemap entries then fill the remaining slots
 * without being visited. Off-site links are dropped unless they are a booking or
 * payment surface, which are worth knowing about and never crawled.
 */
export async function mapSite(url: string): Promise<SiteMap> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let page = await context.newPage();
  const pages = new Map<string, MappedPage>();
  const add = (p: MappedPage) => {
    if (pages.size >= MAX_PAGES) return; // the one cap: sitemap, crawl and depth-3 links all go through here
    const key = normalize(p.url);
    if (!pages.has(key)) pages.set(key, { ...p, url: key });
  };
  const deadline = Date.now() + MAX_CRAWL_MS;
  try {
    const queue: { url: string; depth: number }[] = [{ url: normalize(url), depth: 0 }];
    const seen = new Set<string>([queue[0].url]); // queued or visited — the queue never grows past the page cap
    let crawled = 0;
    while (queue.length && crawled < MAX_PAGES && Date.now() < deadline) {
      const { url: cur, depth } = queue.shift()!;
      let title = "(failed to load)";
      let hrefs: string[] = [];
      let landed = cur;
      try {
        // one page may not stall the crawl: goto has a timeout, title()/$$eval do not
        const read = async () => {
          await page.goto(cur, { waitUntil: "domcontentloaded", timeout: 15_000 });
          await page.waitForTimeout(500);
          landed = normalize(page.url());
          title = (await page.title()).trim();
          hrefs = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
        };
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          read(),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("page hung")), PAGE_MS); }),
        ]).finally(() => clearTimeout(timer));
      } catch (e) {
        // a link that leads nowhere is itself a finding, so it stays in the map;
        // a page that hangs its own scripts gets a fresh tab so the next one is not stuck behind it
        if ((e as Error).message === "page hung") {
          await page.close().catch(() => {});
          page = await context.newPage();
        }
      }
      crawled++;
      const existing = pages.get(cur);
      if (existing) {
        existing.title = title;
        if (existing.depth < 0 || existing.depth > depth) existing.depth = depth;
      } else add({ url: cur, kind: classify(cur), title, depth, external: false });
      // a /book-demo that redirects to cal.com is both a page and an off-site surface
      if (landed !== cur && !sameSite(url, landed)) {
        const kind = classify(landed);
        if (kind === "booking" || kind === "payment") add({ url: landed, kind, title, depth, external: true });
        continue;
      }

      for (const raw of hrefs) {
        const href = normalize(raw);
        if (!/^https?:/.test(href) || SKIP_EXT.test(href)) continue;
        if (!sameSite(url, href)) {
          const kind = classify(href);
          if (kind === "booking" || kind === "payment")
            add({ url: href, kind, title: "", depth: depth + 1, external: true });
          continue;
        }
        if (depth + 1 <= MAX_DEPTH && !seen.has(href) && seen.size < MAX_PAGES) {
          seen.add(href);
          queue.push({ url: href, depth: depth + 1 });
        } else add({ url: href, kind: classify(href), title: "", depth: depth + 1, external: false });
      }
    }
    // sitemap entries fill whatever the crawl left under the cap: a big sitemap
    // once took all 200 slots and the console and legal pages the crawl found were dropped
    const origin = new URL(url).origin;
    for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
      try {
        const res = await context.request.get(`${origin}${path}`, { timeout: 10_000 });
        if (!res.ok()) continue;
        const locs = parseSitemap(await res.text());
        // one level of sitemap index
        for (const loc of locs.slice(0, 20)) {
          // same-site only: a hostile index could otherwise point this fetch at localhost
          if (/sitemap.*\.xml$/i.test(loc) && sameSite(url, loc) && Date.now() < deadline) {
            try {
              const r = await context.request.get(loc, { timeout: 10_000 });
              if (r.ok()) locs.push(...parseSitemap(await r.text()).slice(0, MAX_PAGES));
            } catch { /* one bad child sitemap is not the site's fault */ }
          }
        }
        for (const loc of locs) {
          if (/\.xml$/i.test(loc) || SKIP_EXT.test(loc) || !sameSite(url, loc)) continue;
          add({ url: loc, kind: classify(loc), title: "", depth: -1, external: false });
        }
      } catch { /* no sitemap is normal */ }
    }

    // a page that failed to render gets one plain request: a status decides
    // whether it is broken (4xx/5xx, unreachable) or only slow (200)
    for (const p of pages.values()) {
      if (p.title !== "(failed to load)" || p.external || Date.now() >= deadline) continue;
      try {
        const r = await context.request.get(p.url, { timeout: 10_000, maxRedirects: 5 });
        p.title = r.ok() ? "(slow to render, HTTP 200)" : `HTTP ${r.status()}`;
      } catch {
        p.title = "(unreachable)";
      }
    }
  } finally {
    await browser.close();
  }
  const list = [...pages.values()].sort((a, b) =>
    a.external !== b.external ? Number(a.external) - Number(b.external) : a.url.localeCompare(b.url),
  );
  return { url, generated: new Date().toISOString(), pages: list };
}

/** Map the site once; `force` re-crawls. Returns null when the crawl itself fails. */
export async function ensureMap(url: string, opts: { force?: boolean } = {}): Promise<SiteMap | null> {
  const existing = opts.force ? null : loadMap(url);
  if (existing) return existing;
  let map: SiteMap;
  try {
    map = await mapSite(url);
  } catch (e) {
    console.log(`  (could not map the site: ${(e as Error).message.slice(0, 80)})`);
    return null;
  }
  const p = mapPath(url);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(map, null, 2));
  writeFileSync(p.replace(/map\.json$/, "MAP.md"), renderMap(map));
  return map;
}
