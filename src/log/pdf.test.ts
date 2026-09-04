import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mdToHtml } from "./pdf.js";

describe("mdToHtml", () => {
  it("renders a GFM table with header and body cells", () => {
    const html = mdToHtml("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    assert.match(html, /<table>/);
    assert.match(html, /<th>A<\/th><th>B<\/th>/);
    assert.match(html, /<td>1<\/td><td>2<\/td>/);
    assert.match(html, /<td>3<\/td><td>4<\/td>/);
  });

  it("renders headings, bold, inline code and blockquotes", () => {
    const html = mdToHtml("# Title\n\nsome **bold** and `code`.\n\n> a quote");
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<blockquote>a quote<\/blockquote>/);
  });

  it("keeps a fenced code block verbatim, not as markdown", () => {
    const html = mdToHtml("```\n- not a list\n**not bold**\n```");
    assert.match(html, /<pre>- not a list\n\*\*not bold\*\*<\/pre>/);
  });

  it("escapes HTML so report text cannot inject markup", () => {
    const html = mdToHtml("a <script>alert(1)</script> b");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it("renders a bullet list as <ul><li>", () => {
    const html = mdToHtml("- one\n- two");
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  });
});
