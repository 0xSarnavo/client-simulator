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

/**
 * An auth verb sitting next to a provider name.
 *
 * Non-English sites were unprotected: the guard is a regex over the button's
 * accessible name, and "Continuar con Google" matched nothing. Labels are
 * accent-stripped before matching (see `variants`), so the patterns are too.
 */
const AUTH_VERB = new RegExp(
  [
    "\\b(sign|log)\\s?(in|up)\\b|\\bcontinue with\\b|\\bconnect\\b|\\bauthori[sz]e\\b|\\bauthenticate\\b",
    "\\b(iniciar sesion|continuar|registrarse|acceder|entrar) (con|com)\\b", // es / pt
    "\\b(se connecter|continuer|s'inscrire|connexion) avec\\b", // fr
    "\\b(anmelden|weiter|registrieren|einloggen|fortfahren) mit\\b", // de
    "\\b(accedi|continua|registrati) con\\b", // it
    "\\b(inloggen|doorgaan|aanmelden) met\\b", // nl
    // verb-last word orders ("Mit Google anmelden"). Safe as bare verbs: this
    // pattern is only consulted once a provider name is already in the label.
    "\\b(anmelden|einloggen|registrieren|inloggen|aanmelden|accedi|registrati|acceder|conectar|entrar|iniciar sesion|se connecter|connexion|logga in|login)\\b",
    "войти|регистрация|ログイン|サインイン|로그인|가입",
    "\\b(logga in|fortsatt) med\\b", // sv
    "войти через|продолжить с|войти с помощью", // ru
    "でログイン|でサインイン|で続ける|でつづける", // ja
    "로 로그인|로 계속|으로 로그인|로그인하기", // ko
    "登录|登入|使用.{0,6}登录", // zh
  ].join("|"),
  "i",
);

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
    //
    // Beyond English. Same rule as above — the bare verb only counts as the
    // WHOLE label ("Pagar", like "^pay$"), because "Métodos de pago" is a help
    // link a persona should be free to read. Anything longer must name the
    // commit ("finalizar compra", "kostenpflichtig bestellen").
    "^(pagar|pague|paga|pagare|payer|payez|bezahlen|zahlen|betalen|betaal|paghi)$",
    "\\bpagar ahora\\b|\\bpagar agora\\b|\\bpayer maintenant\\b|\\bjetzt (be)?zahlen\\b|\\bnu betalen\\b",
    "\\b(comprar|compre) (ahora|agora|ya)\\b|\\bacheter maintenant\\b|\\bjetzt kaufen\\b|\\b(acquista|compra) (ora|adesso)\\b",
    "\\bfinalizar (la )?(compra|pedido|pago)\\b|\\brealizar (el )?pedido\\b|\\bconfirmar (y )?(pagar|pago|pedido|compra)\\b",
    "\\bvalider (la |ma |mon )?(commande|paiement|panier)\\b|\\bfinaliser (la |ma |mon )?(commande|achat|paiement)\\b|\\bcommander maintenant\\b",
    "\\bkostenpflichtig bestellen\\b|\\bbestellung (abschicken|aufgeben)\\b|\\bkauf abschliessen\\b|\\bzahlungspflichtig bestellen\\b",
    "\\bcompleta (l'?)?ordine\\b|\\bconferma (e )?paga\\b|\\bprocedi al pagamento\\b",
    "оплатить|купить сейчас|оформить заказ|перейти к оплате|подтвердить оплату",
    "今すぐ購入|購入する|購入を確定|支払う|お支払い|注文を確定|決済する",
    "立即购买|立即支付|马上支付|提交订单|确认支付|去支付|去结算",
    "결제하기|지금 결제|바로 구매|주문하기|결제 진행",
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
const CARD_FIELD = new RegExp(
  [
    "\\b(card ?number|cardnumber|credit ?card|debit ?card|cvv|cvc)\\b",
    "\\bnumero (de |de la |da |do )?(carte|tarjeta|cartao|carta)\\b", // fr/es/pt/it
    "\\bkartennummer\\b|\\bkreditkarte\\b|\\bkaartnummer\\b",
    "номер карты|カード番号|クレジットカード|信用卡号|卡号|카드 ?번호",
  ].join("|"),
  "i",
);

/** Luhn check — the difference between a card number and any long digit string. */
export function looksLikeCardNumber(text: string): boolean {
  const digits = text.replace(/[\s._-]/g, "");
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
 * Every label the snapshot associates with a ref.
 *
 * A page's own TEXT can contain the string "[ref=e12]", and the snapshot renders
 * it verbatim. Taking the FIRST matching line let one hidden node carrying a
 * decoy for every ref on the page ("Continue" [ref=e1] [ref=e2] …) turn the real
 * Pay button, the SSO button and the card field into "Continue" — the whole
 * safety layer off with one div. Candidates are unioned instead, and judged
 * together below, so injected text can only ever ADD a label, never mask one.
 */
export function targetLabels(ariaYaml: string, ref: string): string[] {
  const token = `[ref=${ref}]`;
  const labels: string[] = [];
  for (const line of ariaYaml.split("\n")) {
    if (!line.includes(token)) continue;
    // the node's own accessible name is the quoted string before its ref
    const head = line.slice(0, line.indexOf(token));
    labels.push(/"([^"]*)"\s*$/.exec(head)?.[1] ?? line.trim());
  }
  return labels;
}

/**
 * The accessible name the snapshot gives a ref, e.g. `e12` -> `Sign in with Google`.
 * Returns the whole line when there is no quoted name, so unnamed controls still
 * get judged on whatever text they carry. For display and messages — the checks
 * below judge every candidate, not just this one.
 */
export function targetLabel(ariaYaml: string, ref: string): string {
  return targetLabels(ariaYaml, ref)[0] ?? "";
}

/**
 * Latin lookalikes. "Googlе" with a Cyrillic е read as an ordinary word and
 * sailed past the SSO guard; so did a Greek ο in "Ρay".
 */
const CONFUSABLES: Record<string, string> = {
  а: "a", б: "b", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c",
  т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ӏ: "l",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u",
  χ: "x", ѵ: "v", "０": "0", ⅰ: "i", ｒ: "r",
};

/**
 * Case and accents folded, spacing left alone — `variants` needs the original
 * gaps to tell "P a y   n o w" (two spaced words) from one long one.
 */
function fold(label: string): string {
  return label
    // strip Latin accents ("sesión" -> "sesion", so patterns need no accents) and
    // recompose: NFD alone splits ぐ into く+゛and 결 into jamo, and every
    // Japanese and Korean pattern below stopped matching.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

/** Accessible names arrive with the page's own line breaks and double spaces. */
function normalize(label: string): string {
  return fold(label).replace(/\s+/g, " ").trim();
}

/** Fold lookalike letters into Latin. Kept as a SEPARATE reading — folding is
 *  destructive to real Cyrillic ("оплатить" would become gibberish). */
function deconfuse(label: string): string {
  return [...label].map((c) => CONFUSABLES[c] ?? c).join("");
}

/** "G o o g l e" and "P a y" are the same button, spelled to dodge a regex. */
function unspace(label: string): string {
  return label
    .split(/ {2,}/) // a wider gap is where the real word ends
    .map((word) =>
      word.replace(/\b(?:[\p{L}\p{N}][ \t]+){2,}[\p{L}\p{N}]\b/gu, (run) =>
        run.replace(/[ \t]+/g, ""),
      ),
    )
    .join(" ");
}

/**
 * Every reading of a label worth judging. A page controls how its buttons are
 * spelled, so one spelling is not enough — but folding is one-way, so the
 * untouched reading is kept alongside the folded ones.
 */
function variants(label: string): string[] {
  const base = normalize(label);
  const spaced = unspace(deconfuse(fold(label))).replace(/\s+/g, " ").trim();
  return [...new Set([base, deconfuse(base), spaced])];
}

/**
 * Why this action is refused, or null to allow it.
 * The persona is told the reason and can route around it or walk out — which is
 * itself a finding worth recording.
 */
export function blockedAction(action: DecisionAction, ariaYaml: string): string | null {
  if (action.type === "click" || action.type === "select" || action.type === "type") {
    // fail closed: any candidate label, in any reading, blocks the action
    const labels = targetLabels(ariaYaml, action.target).flatMap(variants);
    const match = (re: RegExp) => labels.find((l) => re.test(l));

    const card = match(CARD_FIELD);
    if (card) {
      return `refused to ${action.type === "type" ? "enter" : "fill"} card details in "${card}" — this client never provides payment information`;
    }
    if (action.type !== "type") {
      const sso = labels.find(isSsoControl);
      if (sso) {
        return `refused to authenticate through a third party ("${sso}") — this client only signs up with an email address`;
      }
      const pay = match(PAYMENT_CONTROL);
      if (pay) {
        return `refused to complete a payment ("${pay}") — this client never pays`;
      }
    }
  }

  if (action.type === "type" && looksLikeCardNumber(action.text)) {
    return `refused to type what looks like a card number — this client never provides payment information`;
  }

  return null;
}
