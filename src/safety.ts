/**
 * Mechanical safety boundary, enforced on ACTIONS rather than URLs.
 *
 * Personas are allowed to walk anywhere — a checkout page, a billing doc, a
 * pricing table — because seeing the wall is the point of the product. What they
 * cannot do is take the two actions that have real-world consequences: pay for
 * something, or authenticate through someone else's identity provider.
 *
 * This replaced a URL blocklist that was wrong in both directions: it killed
 * sessions for reading `/docs/billing` (a help article), while a checkout at
 * `/complete-order` walked straight through it. Judging the action instead of
 * the address fixes both.
 */
import type { DecisionAction } from "./types.js";

/** Identity providers we refuse to authenticate through. */
const SSO_PROVIDERS =
  /\b(google|github|gitlab|apple|microsoft|azure|linkedin|facebook|meta|slack|okta|auth0|saml|onelogin|workos|discord|atlassian|salesforce|bitbucket|twitter|spotify|twitch|yahoo|amazon|wechat|kakao|naver)\b/i;

/** Auth phrasing that names no provider at all. */
const ENTERPRISE_SSO =
  /\bsso\b|single sign[- ]?on|enterprise (login|sign[- ]?in)|work(place)? account|organi[sz]ation account/i;

/** An auth verb sitting next to a provider name. */
const AUTH_VERB = /\b(sign|log)\s?(in|up)\b|\bcontinue with\b|\bconnect\b|\bauthori[sz]e\b|\bauthenticate\b/i;

/**
 * "Sign in with Google", "Continue with Apple", "Use SSO", "Enterprise login",
 * and the bare provider-icon buttons that are now the commonest OAuth control —
 * a button whose entire accessible name is "Google" is a sign-in button.
 * "Continue with email" is not SSO; neither is "Share via Slack".
 */
function isSsoControl(label: string): boolean {
  const l = label.trim();
  if (ENTERPRISE_SSO.test(l)) return true;
  if (!SSO_PROVIDERS.test(l)) return false;
  // strong: an auth verb next to the provider, whatever else the label says
  if (AUTH_VERB.test(l)) return true;
  // weak: a button whose whole accessible name is the provider ("Google").
  // Stripping non-letters means "Share via Slack" cannot match here — only a
  // single provider word can — so no separate share/import guard is needed.
  return SSO_PROVIDERS.test(l.replace(/[^a-z]/gi, "").toLowerCase());
}

/**
 * Controls that actually move money. Deliberately narrow: a bare "Subscribe" or
 * "Upgrade" usually opens a checkout page, which personas are allowed to reach
 * and describe. Only the final commit is refused.
 */
const PAYMENT_CONTROL = new RegExp(
  [
    "^pay$", // Stripe Checkout when the amount is hidden
    "\\bpay (now|\\$|with|securely)",
    "\\b(apple|google|amazon) pay\\b",
    "\\bpaypal\\b",
    "\\bplace (your |my )?order\\b", // Amazon
    "\\bbuy (it )?now\\b", // Shopify dynamic checkout
    "^purchase$|\\bpurchase now\\b",
    "\\border now\\b",
    "\\bcomplete (my |your |the )?(purchase|order|payment|checkout)\\b",
    "\\bconfirm (and |& |&amp; )?pay",
    "\\bsubmit (order|payment)\\b",
    "\\bauthori[sz]e payment\\b",
    "\\bstart (my |your )?(paid )?subscription\\b",
    "\\bdonate now\\b|\\bgive now\\b",
    // NOT a bare "Subscribe": Stripe's commit button uses that label, but it
    // cannot succeed without a card, and card entry is blocked four ways. A
    // newsletter "Subscribe" is a far commoner and genuinely wanted action.
  ].join("|"),
  "i",
);

/** Field labels that mean card data. */
/**
 * Narrow on purpose. "Security code", "expiry" and friends were here and blocked
 * email OTP entry — "Security code" is the standard label for a one-time code at
 * Microsoft, Apple and Amazon, and refusing it broke the whole mail flow. Those
 * fields sit downstream of the card number anyway: a persona that cannot type a
 * PAN never reaches the CVV. One choke point plus an unambiguous backstop.
 */
const CARD_FIELD = /\b(card ?number|cardnumber|credit ?card|debit ?card|cvv|cvc)\b/i;

/** Luhn check — the difference between a card number and any long digit string. */
export function looksLikeCardNumber(text: string): boolean {
  const digits = text.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * The accessible name the snapshot gives a ref, e.g. `e12` -> `Sign in with Google`.
 * Returns the whole line when there is no quoted name, so unnamed controls still
 * get judged on whatever text they carry.
 */
export function targetLabel(ariaYaml: string, ref: string): string {
  const line = ariaYaml
    .split("\n")
    .find((l) => l.includes(`[ref=${ref}]`));
  if (!line) return "";
  return /"([^"]*)"/.exec(line)?.[1] ?? line.trim();
}

/**
 * Why this action is refused, or null to allow it.
 * The persona is told the reason and can route around it or walk out — which is
 * itself a finding worth recording.
 */
export function blockedAction(action: DecisionAction, ariaYaml: string): string | null {
  if (action.type === "click" || action.type === "select") {
    const label = targetLabel(ariaYaml, action.target);
    if (CARD_FIELD.test(label)) {
      return `refused to fill card details in "${label}" — this client never provides payment information`;
    }
    if (isSsoControl(label)) {
      return `refused to authenticate through a third party ("${label}") — this client only signs up with an email address`;
    }
    if (PAYMENT_CONTROL.test(label)) {
      return `refused to complete a payment ("${label}") — this client never pays`;
    }
  }

  if (action.type === "type") {
    const label = targetLabel(ariaYaml, action.target);
    if (CARD_FIELD.test(label)) {
      return `refused to enter card details into "${label}" — this client never provides payment information`;
    }
    if (looksLikeCardNumber(action.text)) {
      return `refused to type what looks like a card number — this client never provides payment information`;
    }
  }

  return null;
}
