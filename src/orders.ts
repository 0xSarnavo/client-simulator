/**
 * Orders: run requests people leave on the website. The site only stores
 * them (a private S3 bucket behind the leakdown-website repo, separate,
 * deploys to Vercel); nothing runs until
 * the operator picks one here, on their own machine and subscription. That
 * is deliberate — an unrun order costs nothing, so spam costs nothing.
 */
import { basename } from "node:path";
import { readFileSync } from "node:fs";

export interface Order {
  id: string;
  url: string;
  email: string;
  createdAt: string;
  status: "new" | "done" | "rejected";
  note?: string;
}

function endpoint(): { base: string; token: string } {
  const base = process.env.LEAKDOWN_ORDERS_URL?.replace(/\/$/, "")
    ?? process.env.CLIENTSIM_ORDERS_URL?.replace(/\/$/, "");
  const token = process.env.LEAKDOWN_ORDERS_TOKEN ?? process.env.CLIENTSIM_ORDERS_TOKEN;
  if (process.env.CLIENTSIM_ORDERS_URL !== undefined || process.env.CLIENTSIM_ORDERS_TOKEN !== undefined) {
    console.warn("CLIENTSIM_* deprecated, use LEAKDOWN_*");
  }
  if (!base || !token) throw new Error("set LEAKDOWN_ORDERS_URL and LEAKDOWN_ORDERS_TOKEN in .env (the website's ORDERS_TOKEN)");
  return { base, token };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { base, token } = endpoint();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export function listOrders(all = false): Promise<Order[]> {
  return call<Order[]>(`/orders${all ? "?all=1" : ""}`);
}

export function getOrder(id: string): Promise<Order> {
  return call<Order>(`/orders/${encodeURIComponent(id)}`);
}

export function setOrderStatus(id: string, status: Order["status"], note = ""): Promise<Order> {
  return call<Order>(`/orders/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ status, note }) });
}

/** A plain-text email with one PDF attached, as raw MIME for curl's SMTP upload. */
export function mimeWithAttachment(opts: { from: string; to: string; subject: string; text: string; pdfPath?: string }): string {
  const boundary = `ld-${Date.now().toString(36)}`;
  // header values come from order fields someone typed into a website form: no line breaks, ever
  const h = (v: string) => v.replace(/[\r\n]+/g, " ");
  const head = [`From: ${h(opts.from)}`, `To: ${h(opts.to)}`, `Subject: ${h(opts.subject)}`, `Date: ${new Date().toUTCString()}`, `MIME-Version: 1.0`];
  if (!opts.pdfPath) return [...head, `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, ``, opts.text, ``].join("\r\n");
  const pdf = readFileSync(opts.pdfPath).toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.text,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${basename(opts.pdfPath)}"`,
    `Content-Disposition: attachment; filename="${basename(opts.pdfPath)}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    pdf,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

export function renderOrders(orders: Order[]): string {
  if (!orders.length) return "  no orders waiting\n";
  const w = Math.max(...orders.map((o) => o.id.length));
  return orders
    .map((o) => `  ${o.id.padEnd(w)}  ${o.status.padEnd(8)}  ${o.url}  ${o.email}  ${o.createdAt.slice(0, 16)}${o.note ? `  — ${o.note}` : ""}`)
    .join("\n") + "\n";
}
