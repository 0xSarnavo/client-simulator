import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { decodeRawMessage, pickBodyParts, type MimeNode } from "./mime.js";
import { extractCodes, extractLinks, formatMessages } from "./types.js";

describe("pickBodyParts", () => {
  it("handles a single-part message, which has no part id", () => {
    assert.deepEqual(pickBodyParts({ type: "text/plain" }), { plain: "1", html: undefined });
  });

  it("finds both alternatives in a multipart message", () => {
    const node: MimeNode = {
      type: "multipart/alternative",
      childNodes: [
        { part: "1", type: "text/plain", size: 300 },
        { part: "2", type: "text/html", size: 4000 },
      ],
    };
    assert.deepEqual(pickBodyParts(node), { plain: "1", html: "2" });
  });

  it("descends through nested multiparts", () => {
    const node: MimeNode = {
      type: "multipart/mixed",
      childNodes: [
        {
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain", size: 100 },
            { part: "1.2", type: "text/html", size: 900 },
          ],
        },
        { part: "2", type: "image/png", size: 50_000 },
      ],
    };
    assert.deepEqual(pickBodyParts(node), { plain: "1.1", html: "1.2" });
  });

  it("ignores attachments, even text ones", () => {
    const node: MimeNode = {
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 200 },
        { part: "2", type: "text/plain", size: 90_000, disposition: "attachment" },
      ],
    };
    assert.equal(pickBodyParts(node).plain, "1");
  });

  it("prefers the larger candidate over a 'view in browser' stub", () => {
    const node: MimeNode = {
      type: "multipart/alternative",
      childNodes: [
        { part: "1", type: "text/html", size: 40 },
        { part: "2", type: "text/html", size: 8000 },
      ],
    };
    assert.equal(pickBodyParts(node).html, "2");
  });

  it("returns nothing readable for an empty or attachment-only message", () => {
    assert.deepEqual(pickBodyParts(undefined), { plain: undefined, html: undefined });
    assert.deepEqual(pickBodyParts({ type: "application/pdf", part: "1" }), {
      plain: undefined,
      html: undefined,
    });
  });
});

describe("decodeRawMessage", () => {
  const headers = (enc: string, ct = "text/html") =>
    `Received: from mail.example.com (10.0.0.1)\r\n` +
    `Delivered-To: cold.a1b2@yourdomain.com\r\n` +
    `Subject: Your code\r\n` +
    `Content-Type: ${ct}; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: ${enc}\r\n\r\n`;

  it("drops headers so infrastructure detail never reaches the prompt", () => {
    const out = decodeRawMessage(headers("7bit", "text/plain") + "Your code is 483920.");
    assert.equal(out.text, "Your code is 483920.");
    assert.ok(!out.text.includes("Received:"));
    assert.ok(!out.text.includes("Delivered-To:"));
  });

  it("decodes base64, which most transactional mail uses", () => {
    const body = Buffer.from("<p>code <b>483920</b></p>").toString("base64");
    const out = decodeRawMessage(headers("base64") + body);
    assert.match(String(out.html), /483920/);
  });

  it("decodes quoted-printable, including soft line breaks", () => {
    const out = decodeRawMessage(headers("quoted-printable") + "code <b>4839=\r\n20</b> =E2=80=94 soon");
    assert.match(String(out.html), /483920/);
    assert.match(String(out.html), /—/); // =E2=80=94 is an em dash
  });

  it("reads a multipart/alternative message", () => {
    const b = "BOUND123";
    const src =
      `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n` +
      `--${b}\r\nContent-Type: text/plain\r\n\r\nYour code is 483920\r\n` +
      `--${b}\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      Buffer.from("<p>483920</p>").toString("base64") + `\r\n--${b}--`;
    const out = decodeRawMessage(src);
    assert.match(out.text, /483920/);
    assert.match(String(out.html), /483920/);
  });

  it("does not throw on malformed input", () => {
    for (const junk of ["", "not a message", "Subject: x", "\r\n\r\n"]) {
      assert.doesNotThrow(() => decodeRawMessage(junk));
    }
  });
});

describe("extractCodes", () => {
  it("finds a plain code", () => {
    assert.ok(extractCodes("Your code", "Your code is 483920").includes("483920"));
  });

  it("does not report a truncated code from a wrapped body", () => {
    // a soft line break used to split this into the wrong code "4839"
    const codes = extractCodes("Your code", "Your code is 4839=\r\n20 today");
    assert.ok(codes.includes("483920"), `got ${JSON.stringify(codes)}`);
    assert.ok(!codes.includes("4839"), "still reporting the truncated code");
  });

  it("reads codes rendered as spaced digit boxes", () => {
    assert.ok(extractCodes("Verify", "<td>4</td><td>8</td> 3 9 2 0").length > 0);
  });

  it("prefers a code near the word 'code' over an unrelated number", () => {
    const codes = extractCodes("Welcome", "Order 998877 shipped. Your code is 483920.");
    assert.equal(codes[0], "483920");
  });

  it("returns nothing when there is no code", () => {
    assert.deepEqual(extractCodes("Hello", "Thanks for signing up! Nothing numeric here."), []);
  });

  it("finds an alphanumeric one-time code, which digits-only search missed", () => {
    // supermemory's login mail sends a 32-char mixed-case token, not digits
    const codes = extractCodes(
      "Logging in",
      "Prefer a code? Use this one instead: one-time code vGmbUhHuBxGgJKVjAnVPApFhACUymESr",
    );
    assert.ok(codes.includes("vGmbUhHuBxGgJKVjAnVPApFhACUymESr"), `got ${codes.join()}`);
  });

  it("does not treat ordinary prose as an alphanumeric code", () => {
    assert.deepEqual(extractCodes("Welcome", "We coded this ourselves. Nothing here matters."), []);
    // a lowercase word right after a cue is a sentence, not a code
    assert.deepEqual(
      extractCodes("Welcome", "Nothing happens without the code. supermemory inc."),
      [],
    );
  });

  it("sees through zero-width preheader padding", () => {
    const padded = `Sign in​‌‍‎‏`.repeat(50) + " your code is 483920";
    assert.ok(extractCodes("Sign in", padded).includes("483920"));
  });
});

describe("extractLinks", () => {
  it("finds a magic link and stops at markup", () => {
    const links = extractLinks('<a href="https://acme.com/verify?t=abc123">Verify</a>');
    assert.deepEqual(links, ["https://acme.com/verify?t=abc123"]);
  });

  it("de-duplicates the same link repeated in a template", () => {
    const l = extractLinks("https://a.com/x https://a.com/x https://a.com/y");
    assert.deepEqual(l, ["https://a.com/x", "https://a.com/y"]);
  });
});

describe("formatMessages", () => {
  it("surfaces the code rather than a raw excerpt", () => {
    const out = formatMessages([
      { from: "no-reply@acme.com", subject: "Your code", text: "Your code is 483920" },
    ]);
    assert.match(out, /codes found: 483920/);
  });

  it("never leaks mail headers into the excerpt", () => {
    const out = formatMessages([
      { from: "a@b.com", subject: "Hi", text: "Welcome aboard, nothing else to see." },
    ]);
    assert.ok(!out.includes("Received:"), "raw headers reached the prompt");
    assert.ok(!out.includes("Delivered-To:"));
  });
});
