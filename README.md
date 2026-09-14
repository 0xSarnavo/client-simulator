# client-simulator

Simulated prospects walk through your website's signup in a real browser, think out loud, and quit the way people do. You get one page: where they stalled, in their words, with the element and a "check it yourself" line — and an expert layer that proposes the fix.

Alpha. Runs on the AI CLI subscription you already have (Claude Code, opencode, Codex). No API keys.

```bash
git clone https://github.com/0xSarnavo/client-simulator
cd client-simulator && npm install && npm run build
npx playwright install chromium
node dist/cli.js --doctor                                  # checks Node, Chromium, your AI CLI, mail
node dist/cli.js your-site.com --ladder --yes --headless   # the whole thing, ~1 hour
```

Then read `runs/your-site.com/AGGREGATE.md`.

## What one run does

| Stage | What happens | Writes |
|---|---|---|
| site | reads the landing page: product, audience, walls; detects bot walls | `SITE.md` |
| map | crawls two clicks + sitemap, no AI: pages by kind, booking/payment surfaces, broken links | `MAP.md` |
| personas | builds 10 prospects that fit the product: core, adjacent, edge | `personas/*.yaml` |
| visit | one browser session per persona; each step: snapshot → decide → act | `session.jsonl`, `shots/`, `video.webm`, `report.md` |
| report | the one-page report, plus every table behind it | `AGGREGATE.md`, `DETAIL.md` |
| fix | expert panel per session | `FIXES.md` |

`--ladder` runs the measured fleet: half the personas on haiku, half on a free opencode model, a mechanical filter keeps only what more than one session cites, sonnet verifies those three sessions, opus re-walks the hardest persona and writes its report. Cheap models vote; only opus writes what you read.

## What the report says

- **The one number** — how many completed, walked out with a reason, ran out of patience.
- **Fix these first** — the three pages prospects left from, who, one quote, and what they were doing right before leaving so you can reproduce it in a browser.
- **Measured on the page** — a ruler, not a persona: controls with no accessible name, tap targets under 24px, sideways scroll, missing viewport meta.
- **For developers** — element refs cited by more than one session; refs seen once are listed as unverified, not hidden.
- **Also found by the crawler** — real 404s and unreachable links.

Read it as risk, not traffic: a simulated prospect stalling is a signal that real visitors could, never a measurement of them.

## What it never does

- Pays, books a meeting, or signs in with Google/GitHub/SSO. Reaching the wall is the finding; the commit is refused by a guard. Best-effort label matching — do not point it at a live checkout and assume it cannot buy.
- Deletes data or invites teammates (prompt rule, not mechanical).
- Runs personas that know your site: cold personas arrive knowing nothing, warm know the pitch, hot know the price and the signup path.

## Email walls

Signup flows send codes and magic links. With a catch-all domain forwarded to an IMAP inbox, every persona gets its own address and reads its own mail:

```
CLIENTSIM_IMAP_HOST="imap.gmail.com"
CLIENTSIM_IMAP_USER="you@gmail.com"
CLIENTSIM_IMAP_PASS="xxxx xxxx xxxx xxxx"   # app password
CLIENTSIM_MAIL_DOMAIN="yourdomain.com"      # catch-all → that inbox
```

`--mailtest` proves the SMTP and IMAP side. Every run checks the mailbox once a day and marks its sessions; if two prospects blame email and nothing inbound arrived, the report says the verdicts are unverified rather than blaming your site.

## Other ways to run it

```bash
client-simulator <url>                                   # plain pipeline, menus for brain, model, who visits
client-simulator <url> --goal "sign up and get an API key" --steps 15 --yes   # pass/fail, exit 0/1, for CI
client-simulator <url> --flow "signup through to the dashboard"               # checkpoints, scored per session
client-simulator <url> --persona marcus,marcus,marcus    # same persona three times
client-simulator --report | --fix <dirs> | --pdf | --replication              # rerun a stage on past sessions
```

Drop `runs/<site>/analytics.json` (top exit pages, device mix, entry sources) and the personas are weighted toward your real visitors.

## Requirements

Node 20+, Chromium via Playwright, one AI CLI logged in: `claude` (Claude Code), `opencode`, or `codex`. A personal subscription hits usage limits on a long sweep; the queue stops and tells you to rerun later — nothing is lost.

## Docs

`AGENTS.md` is the full operating and code guide. `DECISIONS.md` is why the code looks the way it does, including the ideas that were built, measured and thrown away.

MIT.
