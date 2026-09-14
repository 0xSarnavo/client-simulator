import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { mimeWithAttachment, renderOrders } from "./orders.js";

const scratch = mkdtempSync(join(tmpdir(), "clientsim-orders-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe("mimeWithAttachment", () => {
  it("builds a multipart message whose PDF part decodes back to the file", () => {
    const pdf = join(scratch, "x-report.pdf");
    writeFileSync(pdf, Buffer.from("%PDF-1.4 fake"));
    const mime = mimeWithAttachment({ from: "a@x.com", to: "b@y.com", subject: "Report", text: "hello", pdfPath: pdf });
    assert.match(mime, /^From: a@x\.com\r\nTo: b@y\.com\r\nSubject: Report\r\n/);
    assert.match(mime, /Content-Type: multipart\/mixed; boundary="cs-/);
    assert.match(mime, /filename="x-report\.pdf"/);
    const b64 = mime.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
    assert.equal(Buffer.from(b64, "base64").toString(), "%PDF-1.4 fake");
  });

  it("never lets an order field break into a new header", () => {
    const mime = mimeWithAttachment({ from: "a@x.com", to: "b@y.com", subject: "x\r\nBcc: c@z.com", text: "hi" });
    assert.ok(!/^Bcc:/m.test(mime), "CRLF in a subject injected a header");
    assert.match(mime, /^Date: /m);
  });

  it("is plain text when there is no attachment", () => {
    const mime = mimeWithAttachment({ from: "a@x.com", to: "b@y.com", subject: "No", text: "sorry" });
    assert.match(mime, /Content-Type: text\/plain/);
    assert.ok(!mime.includes("multipart"));
  });
});

describe("renderOrders", () => {
  it("lists one order per line, and says so when empty", () => {
    assert.equal(renderOrders([]), "  no orders waiting\n");
    const out = renderOrders([{ id: "2026-09-14-abc", url: "https://x.com", email: "b@y.com", createdAt: "2026-09-14T10:00:00Z", status: "new" }]);
    assert.match(out, /2026-09-14-abc\s+new\s+https:\/\/x\.com\s+b@y\.com/);
  });
});
