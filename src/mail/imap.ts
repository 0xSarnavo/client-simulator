import { randomBytes } from "node:crypto";
import type { Mailbox, MailMessage, MailProvider } from "./types.js";
import { htmlToText } from "./types.js";
import { decodeRawMessage, pickBodyParts, type MimeNode } from "./mime.js";

export interface ImapConfig {
  host: string;
  port?: number;
  user: string;
  pass: string;
  tls?: boolean;
  /** Your catch-all domain — any alias@domain lands in this inbox */
  domain: string;
}

type ImapFlowClient = import("imapflow").ImapFlow;

/** Cap a single body read — newsletters can be megabytes, and this text is prompted */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Ephemeral mailboxes on top of a catch-all IMAP inbox.
 *
 * create() mints a fresh alias (sam.a1b2c3@yourdomain) — no server-side
 * mailbox needed because the catch-all routes everything to one inbox.
 * fetchNew() polls only messages addressed to that alias.
 * destroy() hard-deletes every message addressed to the alias, so the
 * mailbox and its data are gone when the run ends.
 *
 * One IMAP connection is kept alive for the provider's lifetime —
 * handshakes are expensive, polls should be cheap.
 */
export class ImapProvider implements MailProvider {
  readonly kind = "imap";
  private seen = new Map<string, Set<string>>();
  private client?: ImapFlowClient;
  private connecting?: Promise<ImapFlowClient>;
  private junkFolders?: string[];

  constructor(private cfg: ImapConfig) {}

  private async getClient(): Promise<ImapFlowClient> {
    if (this.client?.usable) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const { ImapFlow } = await import("imapflow");
      const c = new ImapFlow({
        host: this.cfg.host,
        port: this.cfg.port ?? 993,
        secure: this.cfg.tls ?? true,
        auth: { user: this.cfg.user, pass: this.cfg.pass },
        logger: false,
      });
      await c.connect();
      return c;
    })();

    try {
      this.client = await this.connecting;
      return this.client;
    } catch (e) {
      this.client = undefined;
      throw e;
    } finally {
      this.connecting = undefined;
    }
  }

  /** Run an operation; reconnect once if the cached connection went bad */
  private async withClient<T>(op: (c: ImapFlowClient) => Promise<T>): Promise<T> {
    try {
      const c = await this.getClient();
      return await op(c);
    } catch (e) {
      // stale/broken connection — rebuild and try exactly once more
      if (this.client) {
        try {
          await this.client.logout();
        } catch {
          /* already dead */
        }
        this.client = undefined;
        const c = await this.getClient();
        return await op(c);
      }
      throw e;
    }
  }

  async create(personaId: string): Promise<Mailbox> {
    const slug = personaId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
    const rand = randomBytes(3).toString("hex");
    return { address: `${slug || "client"}.${rand}@${this.cfg.domain}` };
  }

  /** INBOX plus spam/junk folders. Trash is deliberately excluded —
   *  anything in Trash is already destroyed (Gmail purges Bin after 30 days). */
  private async foldersToScan(c: ImapFlowClient): Promise<string[]> {
    if (this.junkFolders) return ["INBOX", ...this.junkFolders];
    const junk: string[] = [];
    const folders = await c.list();
    for (const f of folders) {
      if (f.specialUse === "\\Junk") {
        junk.push(f.path);
      }
    }
    this.junkFolders = junk;
    return ["INBOX", ...junk];
  }

  async fetchNew(box: Mailbox): Promise<MailMessage[]> {
    return this.withClient(async (c) => {
      const folders = await this.foldersToScan(c);
      const out: MailMessage[] = [];
      const since = new Date(Date.now() - 24 * 3600_000);

      for (const folder of folders) {
        const lock = await c.getMailboxLock(folder);
        try {
          // {uid:true} matters: search() returns SEQUENCE numbers by default,
          // and every read below addresses messages by UID. Mixing the two
          // fetched one message's envelope and another's body — which showed
          // up as mail that arrived with a subject but no content at all.
          const uids =
            (await c.search({ header: { to: box.address }, since }, { uid: true })) || [];
          for (const uid of uids) {
            const key = `${folder}:${uid}`;
            if (this.seenFor(box).has(key)) continue;
            const msg = await c.fetchOne(
              String(uid),
              {
                bodyStructure: true,
                envelope: true,
                internalDate: true,
              },
              { uid: true },
            );
            if (!msg || typeof msg === "boolean") continue;
            const env = msg.envelope;

            this.seenFor(box).add(key);
            const { text, html } = await this.readBody(
              c,
              uid,
              msg.bodyStructure as MimeNode | undefined,
            );
            out.push({
              from:
                env?.from?.[0]?.address ?? env?.from?.[0]?.name ?? "unknown",
              subject: env?.subject ?? "(no subject)",
              date: msg.internalDate ? new Date(msg.internalDate) : undefined,
              text,
              html,
            });
          }
        } finally {
          lock.release();
        }
      }
      return out;
    });
  }

  /**
   * Read a message body with the transfer encoding already undone.
   *
   * The server decodes base64/quoted-printable for us, so codes survive intact.
   * Falls back to the raw source only if the structure has no readable part.
   */
  private async readBody(
    c: ImapFlowClient,
    uid: number,
    structure: MimeNode | undefined,
  ): Promise<{ text: string; html?: string }> {
    const parts = pickBodyParts(structure);

    const grab = async (part?: string): Promise<string | undefined> => {
      if (!part) return undefined;
      try {
        const dl = await c.download(String(uid), part, { uid: true, maxBytes: MAX_BODY_BYTES });
        if (!dl?.content) return undefined;
        const chunks: Buffer[] = [];
        for await (const chunk of dl.content) chunks.push(chunk as Buffer);
        return Buffer.concat(chunks).toString("utf8");
      } catch {
        return undefined;
      }
    };

    const html = await grab(parts.html);
    const plain = await grab(parts.plain);

    if (plain || html) {
      return { text: plain || htmlToText(html ?? ""), html };
    }

    // last resort: raw source, so a strange message is still better than nothing
    try {
      const dl = await c.download(String(uid), undefined, { uid: true, maxBytes: MAX_BODY_BYTES });
      const chunks: Buffer[] = [];
      if (dl?.content) for await (const chunk of dl.content) chunks.push(chunk as Buffer);
      const decoded = decodeRawMessage(Buffer.concat(chunks).toString("utf8"));
      return { text: decoded.text || htmlToText(decoded.html ?? ""), html: decoded.html };
    } catch {
      return { text: "" };
    }
  }

  async destroy(box: Mailbox): Promise<void> {
    await this.withClient(async (c) => {
      // find the trash folder (Gmail calls it "[Gmail]/Bin")
      let trashPath = "[Gmail]/Bin";
      const allFolders = await c.list();
      const trash = allFolders.find((f) => f.specialUse === "\\Trash");
      if (trash) trashPath = trash.path;

      const since = new Date(Date.now() - 7 * 24 * 3600_000);
      // clean every folder the fetcher scans (except Bin itself)
      const scanFolders = (await this.foldersToScan(c)).filter(
        (f) => f !== trashPath,
      );
      for (const folder of scanFolders) {
        const lock = await c.getMailboxLock(folder);
        try {
          // Gmail with auto-expunge off ignores \Deleted/EXPUNGE — moving to
          // Bin is the only true delete. Loop: each pass consumes one batch.
          for (let round = 0; round < 25; round++) {
            // {uid:true} is load-bearing: the moves below are UID-addressed, so
            // searching by sequence number would delete whichever unrelated mail
            // happened to sit at that position in a shared catch-all inbox.
            const uids =
              (await c.search(
                {
                  header: { to: box.address },
                  since,
                },
                { uid: true },
              )) || [];
            if (uids.length === 0) break;
            const before = uids[0];
            for (const uid of uids) {
              await c
                .messageMove(String(uid), trashPath, { uid: true })
                .catch(async () => {
                  await c.messageFlagsAdd(String(uid), ["\\Deleted"], {
                    uid: true,
                  });
                });
            }
            // detect accounts where the server refuses to purge
            // (e.g. Gmail with auto-expunge off) instead of looping forever
            // same units as `before` above, or the stall check never matches
            const recheck =
              (await c.search(
                {
                  header: { to: box.address },
                  since,
                },
                { uid: true },
              )) || [];
            if (recheck.length > 0 && recheck[0] === before) {
              console.warn(
                `\n  ⚠ mailbox destroy incomplete: server refused to purge (Gmail "Auto-Expunge off"?). ` +
                  `${recheck.length} message(s) addressed to ${box.address} remain — delete manually or enable auto-expunge.`,
              );
              break;
            }
          }
        } finally {
          lock.release();
        }
      }
    });
  }

  /** Close the shared connection (call when the whole run is done) */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.logout().catch(() => {});
      this.client = undefined;
    }
  }

  private seenFor(box: Mailbox): Set<string> {
    let s = this.seen.get(box.address);
    if (!s) {
      s = new Set();
      this.seen.set(box.address, s);
    }
    return s;
  }
}
