export interface Mailbox {
  /** The deliverable address the persona uses in signup forms */
  address: string;
}

export interface MailMessage {
  from: string;
  subject: string;
  date?: Date;
  text: string;
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
  const body = htmlToText(parts.slice(1).join("\n"));
  const haystack = `${subject}\n${body}`;

  const raw = [...new Set(
    (haystack.match(CODE_RE) ?? []).map((c) => c.replace(/\s+/g, "")),
  )];

  // rank: codes near the word "code/verify/otp" first, then by appearance
  const scored = raw.map((code) => {
    const idx = haystack.search(new RegExp(code.split("").join("\\s?")));
    const context = haystack.slice(Math.max(0, idx - 80), idx + code.length + 40);
    const nearCodeWord = /code|verify|otp/i.test(context) ? 0 : 1;
    return { code, nearCodeWord, idx };
  });
  scored.sort((a, b) => a.nearCodeWord - b.nearCodeWord || a.idx - b.idx);
  return scored.map((s) => s.code).slice(0, 5);
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
