/**
 * Choosing which part of a MIME message to read.
 *
 * Fetching the raw RFC822 source and regexing it does not work: most
 * transactional mail is base64 or quoted-printable, so a verification code is
 * either invisible (base64) or split across a soft line break (quoted-printable,
 * where "4839=\r\n20" reads as the wrong code "4839"). Asking the IMAP server
 * for the decoded body part instead sidesteps all of that.
 */

/** The shape of imapflow's bodyStructure, narrowed to what we need. */
export interface MimeNode {
  part?: string;
  type: string;
  encoding?: string;
  disposition?: string;
  size?: number;
  childNodes?: MimeNode[];
}

export interface ChosenParts {
  /** Part id of the text/plain body, if any */
  plain?: string;
  /** Part id of the text/html body, if any */
  html?: string;
}

/**
 * Find the readable body parts, preferring the largest candidate of each type.
 *
 * Attachments are skipped, and so are the tiny alternative stubs some senders
 * include ("view this in your browser"), which is why size decides between
 * competing parts rather than document order.
 */
export function pickBodyParts(node: MimeNode | undefined): ChosenParts {
  const best: { plain?: MimeNode; html?: MimeNode } = {};

  const walk = (n: MimeNode | undefined) => {
    if (!n) return;
    if (n.childNodes?.length) {
      for (const child of n.childNodes) walk(child);
      return;
    }
    // an attached .txt/.html file is not the message body
    if (n.disposition && n.disposition.toLowerCase() === "attachment") return;

    const type = (n.type ?? "").toLowerCase();
    const slot = type === "text/plain" ? "plain" : type === "text/html" ? "html" : null;
    if (!slot) return;

    const current = best[slot];
    if (!current || (n.size ?? 0) > (current.size ?? 0)) best[slot] = n;
  };

  walk(node);

  return {
    // a single-part message has no part id; imapflow addresses its body as "1"
    plain: best.plain ? (best.plain.part ?? "1") : undefined,
    html: best.html ? (best.html.part ?? "1") : undefined,
  };
}

/**
 * Decode a raw RFC822 message far enough to read it.
 *
 * Only used when the server could not give us a decoded body part. It strips
 * headers (so the persona is not shown Received: lines), honours the transfer
 * encoding, and for multipart messages takes the first readable text part.
 */
export function decodeRawMessage(source: string): { text: string; html?: string } {
  const { headers, body } = splitHeaders(source);
  const contentType = headerValue(headers, "content-type") ?? "text/plain";
  const boundary = /boundary="?([^";\s]+)"?/i.exec(contentType)?.[1];

  if (boundary) {
    // walk the parts, keeping the best text/plain and text/html we find
    let plain: string | undefined;
    let html: string | undefined;
    for (const chunk of body.split(`--${boundary}`)) {
      const trimmed = chunk.trim();
      if (!trimmed || trimmed === "--") continue;
      const part = decodeRawMessage(chunk.replace(/^\r?\n/, ""));
      if (part.html && !html) html = part.html;
      else if (part.text && !plain) plain = part.text;
    }
    return { text: plain || (html ? "" : ""), html };
  }

  const decoded = decodeTransfer(body, headerValue(headers, "content-transfer-encoding"));
  return /text\/html/i.test(contentType)
    ? { text: "", html: decoded }
    : { text: decoded };
}

function splitHeaders(source: string): { headers: string; body: string } {
  const split = source.search(/\r?\n\r?\n/);
  if (split === -1) return { headers: "", body: source };
  return {
    headers: source.slice(0, split),
    body: source.slice(split).replace(/^\r?\n\r?\n/, ""),
  };
}

function headerValue(headers: string, name: string): string | undefined {
  // headers can be folded across lines, so join continuations before matching
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const line = unfolded
    .split(/\r?\n/)
    .find((l) => l.toLowerCase().startsWith(`${name}:`));
  return line?.slice(name.length + 1).trim();
}

function decodeTransfer(body: string, encoding?: string): string {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64":
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    case "quoted-printable": {
      const unfolded = body.replace(/=\r?\n/g, ""); // soft line breaks
      // =E2=80=94 is one UTF-8 character across three bytes, so collect the
      // bytes and decode once rather than per-escape
      const bytes: number[] = [];
      for (let i = 0; i < unfolded.length; i++) {
        const esc = /^=([0-9A-F]{2})/i.exec(unfolded.slice(i, i + 3));
        if (esc) {
          bytes.push(parseInt(esc[1], 16));
          i += 2;
        } else {
          bytes.push(...Buffer.from(unfolded[i], "utf8"));
        }
      }
      return Buffer.from(bytes).toString("utf8");
    }
    default:
      return body;
  }
}
