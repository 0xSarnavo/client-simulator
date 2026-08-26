export interface Mailbox {
  /** The deliverable address the persona uses in signup forms */
  address: string;
}

export interface MailMessage {
  from: string;
  subject: string;
  date?: Date;
  /** Decoded readable body — never raw MIME source */
  text: string;
  /** Decoded HTML body when the message has one, for rendering a screenshot */
  html?: string;
}

export interface MailProvider {
  readonly kind: string;
  /** Create an ephemeral mailbox for a persona run */
  create(personaId: string): Promise<Mailbox>;
  /** Return only NEW messages addressed to this mailbox since the last call */
  fetchNew(box: Mailbox): Promise<MailMessage[]>;
  /** Destroy the mailbox — purge its messages so nothing remains */
  destroy(box: Mailbox): Promise<void>;
}

const CODE_RE = /\b\d(?:[ \t]?\d){3,7}\b/g;

/**
 * Zero-width and bidi characters used as email preheader padding.
 *
 * Senders pad the preview line with hundreds of these. Left in, they burn the
 * whole body excerpt a persona gets to see — one login mail spent its first 700
 * characters on padding, so the excerpt held nothing but invisible filler.
 */
const INVISIBLE_RE = /[​-‏⁠­﻿]/g;

/** Drop invisible padding so an excerpt is made of characters a human could read */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_RE, "");
}

/** Alphanumeric one-time codes, which only count when a cue word introduces them */
const ALNUM_CODE_RE = /(?:code|token|otp|passcode)\b[^A-Za-z0-9]{0,20}([A-Za-z0-9]{6,48})\b/gi;

/** Strip HTML down to visible text (styles/scripts removed, tags dropped, entities decoded) */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ");
}

/** Pull verification codes out of a message (subject + body).
 *  Handles styled "4 6 4 3 4 0" digit boxes and prefers codes near the word "code". */
export function extractCodes(...parts: string[]): string[] {
  const subject = parts[0] ?? "";
  // Undo quoted-printable soft line breaks first. Bodies normally arrive
  // already decoded, but on the raw-source fallback a wrapped "4839=\r\n20"
  // would otherwise yield the wrong code "4839" — worse than finding none.
  const unfolded = parts.slice(1).join("\n").replace(/=\r?\n/g, "");
  const body = htmlToText(unfolded);
  const haystack = stripInvisible(`${subject}\n${body}`);

  const raw = [...new Set(
    (haystack.match(CODE_RE) ?? []).map((c) => c.replace(/\s+/g, "")),
  )];

  // Rank by where the cue word sits. "Order 998877 shipped. Your code is 483920"
  // used to tie, because a single window around each number saw "code" either
  // way; a cue *before* the number is the far stronger signal.
  const CUE = /code|verify|otp|pin|passcode/i;
  const scored = raw.map((code) => {
    const idx = haystack.search(new RegExp(code.split("").join("\\s?")));
    const rank = CUE.test(haystack.slice(Math.max(0, idx - 60), idx))
      ? 0
      : CUE.test(haystack.slice(idx + code.length, idx + code.length + 30))
        ? 1
        : 2;
    return { code, rank, idx };
  });
  scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  const numeric = scored.map((s) => s.code);

  // Not every one-time code is digits — supermemory's login mail sends a 32-char
  // mixed-case token, which a digits-only search reported as "no code found".
  // Only cue-introduced tokens qualify, so ordinary body words stay out.
  const alnum: string[] = [];
  for (const m of haystack.matchAll(ALNUM_CODE_RE)) {
    const token = m[1];
    // A cue word alone is not enough: "…or the code. supermemory inc." would
    // offer "supermemory". Real codes carry a digit, mixed case, or all-caps —
    // a plain lowercase word does not, and is still readable in the body text.
    const codeLike = /\d/.test(token) || token !== token.toLowerCase();
    if (!codeLike || numeric.includes(token) || alnum.includes(token)) continue;
    alnum.push(token);
  }

  return [...numeric, ...alnum].slice(0, 5);
}

/** Pull links out of a message (magic links, verify buttons) */
export function extractLinks(...parts: string[]): string[] {
  const haystack = parts.filter(Boolean).join("\n");
  return [...new Set(haystack.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])].slice(0, 5);
}

/** Render fetched messages into compact prompt-ready text */
export function formatMessages(msgs: MailMessage[]): string {
  return msgs
    .map((m, i) => {
      const codes = extractCodes(m.subject, m.text);
      const links = extractLinks(m.text);
      return [
        `mail #${i + 1}`,
        `  from: ${m.from}`,
        `  subject: ${m.subject}`,
        codes.length ? `  codes found: ${codes.join(", ")}` : null,
        links.length ? `  links:\n${links.map((l) => `    - ${l}`).join("\n")}` : null,
        !codes.length && !links.length
          ? `  excerpt: ${m.text.replace(/\s+/g, " ").slice(0, 200)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
