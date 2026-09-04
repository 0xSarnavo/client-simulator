/**
 * Turn a site's markdown reports into one shareable PDF.
 *
 * No new dependency: Playwright's Chromium prints to PDF natively, and the
 * markdown these reports use is a small, known subset (headings, GFM tables,
 * lists, bold, inline code, blockquotes, rules, fenced code). A full markdown
 * engine would be a dependency for a page a person reads once — so the subset
 * is rendered here, and anything unrecognised falls through as a paragraph.
 */
import { existsSync, readFileSync } from "node:fs";
import { RUNS_ROOT, siteSlug, findSessionDirs } from "../runs.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline spans: `code` and **bold**. Escaped first, so page text is inert. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** A GFM pipe-table row split into cells, outer pipes trimmed. */
function cells(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}
const isTableSep = (l: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes("-");

/** The known-subset markdown → HTML. Deliberately line-oriented. */
export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code — passthrough until the closing fence
    if (/^```/.test(line)) {
      flush();
      const buf: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(esc(lines[i]));
      out.push(`<pre>${buf.join("\n")}</pre>`);
      continue;
    }

    // table — a header row followed by a |---| separator
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
        rows.push(cells(lines[i]));
      }
      i--; // step back; the for-loop will advance
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      for (; i < lines.length && /^\s*[-*]\s+/.test(lines[i]); i++) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
      }
      i--;
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join("\n");
}

const CSS = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color: #1a1a1a; }
  h1 { font-size: 22px; border-bottom: 2px solid #222; padding-bottom: 6px; }
  h2 { font-size: 17px; margin-top: 22px; }
  h3 { font-size: 14px; color: #333; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace,Menlo,monospace; font-size: 11.5px; }
  pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; font-family: ui-monospace,Menlo,monospace; font-size: 11px; }
  blockquote { border-left: 3px solid #bbb; margin: 8px 0; padding: 2px 12px; color: #444; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 18px 0; }
  .site-report > h1:first-child { page-break-before: avoid; }
  h2 { page-break-after: avoid; }
  table, pre, blockquote { page-break-inside: avoid; }
`;

/** A session's recorded model, or null. */
function sessionModel(dir: string): string | null {
  try {
    return (JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")) as { model?: string }).model ?? null;
  } catch {
    return null;
  }
}

/** Best model present, so a send-ready packet uses one brain, not six. */
const MODEL_RANK = ["opus", "sonnet", "haiku"];
function preferredModel(dirs: string[]): string | null {
  const present = new Set(dirs.map(sessionModel).filter((m): m is string => !!m));
  for (const m of MODEL_RANK) if (present.has(m)) return m;
  return [...present][0] ?? null; // else the first opencode model we have
}

/**
 * Which markdown files make up a site's shareable packet, in reading order:
 * the funnel, then one model's expert reports (not all six — a sweep bundles
 * dozens of sessions and the packet is for a person to read).
 */
export function packetFor(url: string, model?: string): { files: string[]; model: string | null } {
  const site = siteSlug(url);
  const files: string[] = [];
  const aggregate = `${RUNS_ROOT}/${site}/AGGREGATE.md`;
  if (existsSync(aggregate)) files.push(aggregate);

  const sessionDirs = findSessionDirs(`${RUNS_ROOT}/${site}`);
  const chosen = model ?? preferredModel(sessionDirs);
  for (const dir of sessionDirs) {
    if (existsSync(`${dir}/FIXES.md`) && (!chosen || sessionModel(dir) === chosen)) {
      files.push(`${dir}/FIXES.md`);
    }
  }
  return { files, model: chosen };
}

/** Assemble a site's markdown packet into one HTML document. */
export function packetHtml(url: string, files: string[], model?: string | null): string {
  const body = files
    .map((f) => `<section class="site-report">${mdToHtml(readFileSync(f, "utf8"))}</section>`)
    .join('\n<hr>\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<h1>${esc(siteSlug(url))} — simulated-prospect report</h1>
<p>Generated by client-simulator${model ? ` (${esc(model)})` : ""}. Findings are risk signals from simulated visitors, not measured traffic.</p>
${body}
</body></html>`;
}

/** Render HTML to a PDF file with headless Chromium. Returns the path. */
export async function htmlToPdf(html: string, outPath: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outPath, format: "A4", printBackground: true });
    return outPath;
  } finally {
    await browser.close().catch(() => {});
  }
}
