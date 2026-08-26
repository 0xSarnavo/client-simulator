import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { blockedAction, looksLikeCardNumber, targetLabel } from "./safety.js";
import type { DecisionAction } from "./types.js";

const aria = [
  '- button "Sign up with Google" [ref=e1]',
  '- button "Continue with email" [ref=e2]',
  '- button "Sign up" [ref=e3]',
  '- button "Place order" [ref=e4]',
  '- button "Subscribe" [ref=e5]',
  '- button "See pricing" [ref=e6]',
  '- textbox "Card number" [ref=e7]',
  '- textbox "Work email" [ref=e8]',
  '- button "Use SSO" [ref=e9]',
  '- link "Billing docs" [ref=e10]',
  '- button "Continue with Apple" [ref=e11]',
  '- textbox "CVV" [ref=e12]',
  '- button "Pay now" [ref=e13]',
  '- button "Upgrade" [ref=e14]',
  '- button "Subscribe to newsletter" [ref=e15]',
  '- button "Buy it now" [ref=e16]',
  '- button "Place your order" [ref=e17]',
  '- button "Pay" [ref=e18]',
  '- button "Confirm & pay" [ref=e19]',
  '- button "Complete your order" [ref=e20]',
  '- button "Pay with PayPal" [ref=e21]',
  '- button "Google" [ref=e22]',
  '- button "Log in with your work account" [ref=e23]',
  '- button "Enterprise login" [ref=e24]',
  '- button "Sign up with Discord" [ref=e25]',
  '- textbox "Security code" [ref=e26]',
  '- textbox "Expiration date" [ref=e27]',
  '- button "Share via Slack" [ref=e28]',
  '- button "Import from Google Docs" [ref=e29]',
  '- combobox "Card number" [ref=e30]',
  '- button "Donate" [ref=e31]',
].join("\n");

const select = (target: string): DecisionAction => ({ type: "select", target, value: "x" });

const click = (target: string): DecisionAction => ({ type: "click", target });
const type = (target: string, text: string): DecisionAction => ({ type: "type", target, text });

describe("targetLabel", () => {
  it("reads the accessible name for a ref", () => {
    assert.equal(targetLabel(aria, "e1"), "Sign up with Google");
  });
  it("returns empty for an unknown ref", () => {
    assert.equal(targetLabel(aria, "e999"), "");
  });
});

describe("blocked: third-party auth", () => {
  for (const ref of ["e1", "e9", "e11"]) {
    it(`refuses ${targetLabel(aria, ref)}`, () => {
      assert.match(String(blockedAction(click(ref), aria)), /authenticate through a third party|SSO/i);
    });
  }

  it("allows plain email signup — 'Continue with email' is not SSO", () => {
    assert.equal(blockedAction(click("e2"), aria), null);
  });

  it("allows a plain Sign up button", () => {
    assert.equal(blockedAction(click("e3"), aria), null);
  });

  it("refuses a bare provider icon button", () => {
    // "Google" with no verb is the commonest OAuth control on modern signups
    assert.match(String(blockedAction(click("e22"), aria)), /third party/);
  });

  it("refuses enterprise SSO that never names a provider", () => {
    assert.match(String(blockedAction(click("e23"), aria)), /third party/);
    assert.match(String(blockedAction(click("e24"), aria)), /third party/);
  });

  it("refuses providers beyond the obvious three", () => {
    assert.match(String(blockedAction(click("e25"), aria)), /third party/);
  });

  it("blocks an auth control even when a purpose clause follows it", () => {
    // a trailing "to import your contacts" must not switch the rule off
    const label = (t: string) => `- button "${t}" [ref=e1]`;
    for (const t of [
      "Sign in with Google to import your contacts",
      "Log in with Google to copy this template",
    ]) {
      assert.match(String(blockedAction(click("e1"), label(t))), /third party/, t);
    }
  });

  it("blocks OAuth grant buttons phrased as 'Connect to X'", () => {
    for (const t of ["Connect to Slack", "Connect to Google Drive", "Connect to GitHub"]) {
      const aria2 = `- button "${t}" [ref=e1]`;
      assert.match(String(blockedAction(click("e1"), aria2)), /third party/, t);
    }
  });

  it("does not treat B2B onboarding steps as third-party auth", () => {
    // "Create organization" is a step in nearly every B2B signup; an earlier
    // version matched any label containing the word and manufactured drop-offs
    for (const t of ["Create an organization", "Organization name", "Organization settings", "Set up your organisation"]) {
      const aria2 = `- button "${t}" [ref=e1]`;
      assert.equal(blockedAction(click("e1"), aria2), null, `blocked ${t}`);
    }
    // the real enterprise-SSO phrasing still is
    const sso = '- button "Sign in with your organization account" [ref=e1]';
    assert.match(String(blockedAction(click("e1"), sso)), /third party/);
  });

  it("blocks an OAuth grant with or without the preposition", () => {
    for (const t of ["Connect Google Drive", "Connect to Google Drive"]) {
      const aria2 = `- button "${t}" [ref=e1]`;
      assert.match(String(blockedAction(click("e1"), aria2)), /third party/, t);
    }
  });

  it("does not treat address-form fields as identity providers", () => {
    // "line" once matched the LINE messenger and every checkout address form
    for (const t of ["Line 1", "Line 2", "Address line 1"]) {
      const aria2 = `- textbox "${t}" [ref=e1]`;
      assert.equal(blockedAction(type("e1", "221B Baker St"), aria2), null, t);
    }
  });

  it("allows sharing and importing, which merely name a provider", () => {
    assert.equal(blockedAction(click("e28"), aria), null, "blocked Share via Slack");
    assert.equal(blockedAction(click("e29"), aria), null, "blocked Import from Google Docs");
  });
});

describe("blocked: paying", () => {
  it("refuses the final commit buttons", () => {
    assert.match(String(blockedAction(click("e4"), aria)), /never pays/);
    assert.match(String(blockedAction(click("e13"), aria)), /never pays/);
  });

  it("refuses 'Donate now' but not a Donate nav link", () => {
    const commit = '- button "Donate now" [ref=e1]';
    assert.match(String(blockedAction(click("e1"), commit)), /never pays/);
  });

  it("refuses the real commit labels of the big platforms", () => {
    // Shopify, Amazon, Stripe Checkout, PayPal — all previously allowed
    for (const ref of ["e16", "e17", "e18", "e19", "e20", "e21"]) {
      assert.match(
        String(blockedAction(click(ref), aria)),
        /never pays/,
        `allowed ${targetLabel(aria, ref)}`,
      );
    }
  });

  it("allows a bare Subscribe — a newsletter CTA is the commoner case", () => {
    // Stripe's commit button uses this label, but it cannot succeed without a
    // card, and card entry is blocked by label, Luhn, iframes and a fresh context
    assert.equal(blockedAction(click("e5"), aria), null);
  });

  it("allows nav and legal links that merely contain a payment word", () => {
    for (const t of ["Purchase history", "Terms of purchase", "Purchase agreement", "Donate"]) {
      const aria2 = `- link "${t}" [ref=e1]`;
      assert.equal(blockedAction(click("e1"), aria2), null, `blocked ${t}`);
    }
  });

  it("refuses card details chosen from a dropdown, not just typed", () => {
    assert.match(String(blockedAction(select("e30"), aria)), /card details/);
  });

  it("allows reaching a checkout — only the commit is refused", () => {
    // the point of the product is seeing the wall, so these must go through
    for (const ref of ["e5", "e6", "e10", "e14", "e15"]) {
      assert.equal(blockedAction(click(ref), aria), null, `blocked ${targetLabel(aria, ref)}`);
    }
  });

  it("refuses card fields by label", () => {
    assert.match(String(blockedAction(type("e7", "4111111111111111"), aria)), /card details/);
    assert.match(String(blockedAction(type("e12", "123"), aria)), /card details/);
  });

  it("refuses a card number typed into an innocuous field", () => {
    assert.match(String(blockedAction(type("e8", "4111 1111 1111 1111"), aria)), /card number/);
  });

  it("allows an ordinary email into an ordinary field", () => {
    assert.equal(blockedAction(type("e8", "cold.a1b2@example.com"), aria), null);
  });

  it("ALLOWS an email OTP typed into a 'Security code' field", () => {
    // this label is the standard for one-time codes at Microsoft/Apple/Amazon;
    // blocking it broke the entire mail verification flow
    assert.equal(blockedAction(type("e26", "483920"), aria), null);
  });

  it("allows non-card date fields", () => {
    assert.equal(blockedAction(type("e27", "2026-08-26"), aria), null);
  });
});

describe("looksLikeCardNumber", () => {
  it("accepts real test card numbers, spaced or not", () => {
    assert.ok(looksLikeCardNumber("4111111111111111"));
    assert.ok(looksLikeCardNumber("4111 1111 1111 1111"));
    assert.ok(looksLikeCardNumber("5500-0000-0000-0004"));
  });

  it("rejects things that merely look long", () => {
    // an order id, a phone number, a date — none should trip the card guard
    for (const s of ["1234567890123456", "07700900123", "2026-08-26", "483920", ""]) {
      assert.ok(!looksLikeCardNumber(s), `treated ${s} as a card`);
    }
  });
});

describe("actions with no target are never blocked", () => {
  it("lets scroll, back, wait and abandon through", () => {
    const actions: DecisionAction[] = [
      { type: "scroll", direction: "down" },
      { type: "back" },
      { type: "wait", seconds: 3 },
      { type: "abandon", reason: "r", question: "q" },
    ];
    for (const a of actions) assert.equal(blockedAction(a, aria), null, a.type);
  });
});
