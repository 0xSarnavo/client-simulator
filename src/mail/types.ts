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

const CODE_RE = /\b\d{4,8}\b/g;

/** Pull verification codes out of a message (subject + body) */
export function extractCodes(...parts: string[]): string[] {
  const haystack = parts.filter(Boolean).join("\n");
  return [...new Set(haystack.match(CODE_RE) ?? [])].slice(0, 5);
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
