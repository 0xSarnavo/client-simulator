# DECISIONS.md

Why the code looks the way it does. Newest first.

**Read the "Tried and rejected" table at the bottom before proposing anything.** It
exists so nobody spends an afternoon rebuilding something that was already measured
and thrown away.

**When to add an entry:** a session made a real choice — rejected an alternative,
hit a constraint that shaped the design, or reversed an earlier decision. Not for
mechanical work. If you cannot fill in **Why**, there is no entry to write.

**Format:**

```markdown
## YYYY-MM-DD — one line, what changed
**Decided:** what was done.
**Why:** the problem, with the evidence that proved it.
**Rejected:** what else was tried, and what killed it. Omit if nothing was.
**Files:** paths.
**Ref:** commit hash, or "uncommitted".
```

---

## 2026-09-04 — Booking commits join payment and SSO in the action guard

**Decided:** `blockedAction` refuses scheduler commit controls — "Schedule
Event", "Confirm meeting", "Book this slot", "Book now" — and a bare
"Confirm"/"Schedule"/"Book" when the URL or the snapshot says scheduler
(cal.com, Calendly, SavvyCal, Chili Piper, timezone chrome). `blockedAction`
gained an optional `url` parameter for that context. Openers ("Book a demo",
"Request access") stay clickable and the booking form stays fillable — only
the commit is refused, mirroring how checkout is handled.

**Why:** not hypothetical. During the model sweep, two sessions on amulet.so
completed real cal.com bookings — "Amulet Discovery 20m", a real founder's
calendar, a fake name, an ephemeral email. The demo-gate was already the
finding by the time the calendar loaded; finishing the booking added nothing
to the report and put a meeting on a human's schedule.

**Rejected:** blocking bare "Confirm" everywhere. It is the standard button on
OTP screens, and refusing it would break the mail flow the same way blocking
"Security code" once did — hence the scheduler-context gate.

**Files:** `src/safety.ts`, `src/session.ts`, `src/types.ts`, `AGENTS.md`

**Ref:** uncommitted

## 2026-09-04 — One malformed persona no longer discards the generated set

**Decided:** persona generation validates per element: bad entries are dropped
with a printed reason, and only an all-bad reply fails.

**Why:** the first multi-model sweep caught it in minutes. haiku answered
`tech_comfort: "medium-high"` on 4 of 10 personas and `z.array(...).parse`
threw the whole set away — the run silently fell back to 3 built-ins, which is
exactly the wrong queue for a sweep comparing models on identical prospects.
Same failure class as the expert scorecard (`24de073`): weaker models bend
enums, and the harness's job is to keep the valid majority.

**Files:** `src/persona/generate.ts`

**Ref:** `6322ef9`

## 2026-09-04 — The brief's scrape doubles as a bot-wall scout

**Decided:** `botWallMarker()` checks the scraped page text for known walls —
Cloudflare's "Just a moment", browser checks, captcha, "verify you are human",
PerimeterX, DDoS-Guard. A hit writes `runs/<site>/BLOCKED.md` and every run
skips the site with one line until the marker is deleted or `--plan` re-checks.
Default persona set went 5 → 10 in the same session (operator request, for
whole-portfolio batch runs; `MAX_RUNS` was already 10).

**Why:** batch-running ten sites at ten agents each, a bot-walled site would
send every persona into the same interstitial — ten identical GUARDRAILs at
full patience cost, filed as findings about a page nobody ever saw. One scout
read is enough to know; the scrape for the site brief already is that read, so
detection costs nothing new.

**Files:** `src/site/brief.ts`, `src/cli.ts`

**Ref:** uncommitted

## 2026-09-04 — Reports warn about risk; they do not claim measurement

**Decided:** every rendered surface says what a simulation can say: "N simulated
prospect(s) walked out here; real visitors may too", never "users dropped here".
Both reports carry a "Read as: risk signal, not measured traffic" line, and the
expert panel is told the same in `trailSummary` — one edit that reaches all
seven prompts, since every expert renders the trail through it.

**Why:** the operator shows these reports to site owners. A tool that has sent
five language models through a page has evidence of risk, not of user
behaviour, and phrasing it as the latter is the report over-claiming — the same
class of error as describing a prompt-only rule as enforced.

**Deliberately narrow:** the exit kinds (`completed`/`abandoned`/`guardrail`)
and every schema are untouched. Renaming them would make every session on disk
— including the 931MB backup — unreadable. Framing lives in the renderers.

**Files:** `src/log/report.ts`, `src/log/aggregate.ts`, `src/experts/types.ts`

**Ref:** uncommitted

## 2026-09-04 — A session has a wall-clock ceiling, and waiting is not charged

**Decided:** `--time <minutes>` (default 20, max 120) hard-stops a session as a
guardrail. Time spent polling mail and in deliberate `wait` actions is
excluded from the clock; the exit detail says how much was excluded.

**Why:** sessions had no time bound at all — only step bounds — so a slow site
plus a slow brain could run indefinitely. But charging the clock for mail
delivery would recreate the bug paid for twice already (OTP keystrokes,
quoted-printable codes): the site being blamed for the harness's mail path.
Same logic that made scrolling free. `patience_steps` is untouched — it stays
the in-character "I give up", the clock is infrastructure.

**Files:** `src/session.ts`, `src/cli.ts`

**Ref:** uncommitted

## 2026-09-04 — The flow under test is stated, reviewed, and scored once per session

**Decided:** `--flow "<intent>"` (or the interactive question) has the brain
draft 2–8 ordered checkpoints from the site brief into `runs/<site>/FLOW.md`,
behind a review gate — use / regenerate / edit the file / no flow. The flow
shapes persona *generation* (goals become personal variations of it). After a
session, ONE un-retried call judges which checkpoints were reached, into
`meta.json`, the session report, and a funnel table in `AGGREGATE.md`
("checkpoint 3: 1/5 reached"). No flow file → the tool behaves exactly as
before.

**Why:** the operator knows what they want tested; the tool only knew
temperatures. And the aggregate could count verdicts but not say *where along
the journey* prospects fell out — the funnel is the first cross-session view
of the same wall (PLAN.md's top open problem, partially).

**Rejected:** overriding persona goals at run time with the flow — a hot
persona whose goal contradicts what it supposedly already researched is
incoherent. Also rejected: per-step checkpoint assertion, which would triple
the call count and pollute the persona's own decision loop; scoring reads the
finished trail instead.

**Files:** `src/site/flow.ts` (new), `src/cli.ts`, `src/persona/generate.ts`,
`src/log/report.ts`, `src/log/aggregate.ts`

**Ref:** uncommitted

## 2026-09-04 — Queued personas run concurrently; the queue is the cap

**Decided:** every queued persona launches at once (`Promise.all`), default
generated set is 5. Per agent: its own brain, browser, `ImapProvider`, and a
session dir minted serially before launch. When more than one runs, session
output lines are prefixed `[persona-id]` and the transient spinner writes are
suppressed. One persona's setup failure does not kill the others.

**Why:** with a 15–30 minute wall-clock budget per agent, five serial sessions
are 75–150 minutes of operator time for work that is embarrassingly parallel —
every session was already isolated (646556a did the hard part). The two things
that were actually shared: the IMAP provider (one stateful connection —
concurrent polls interleave on one socket) and stdout (clearLine/cursorTo races
shred interleaved output). `sessionPath()`'s same-second dedupe is
exists-then-create, so dirs are created before anything runs concurrently.

**Files:** `src/cli.ts`, `src/session.ts`

**Ref:** uncommitted

## 2026-09-04 — A gate between stages: continue, redo, change settings, stop

**Decided:** interactive runs pause after `visit` and after `report`: continue /
redo the stage that just ran / change settings (reopens the brain-model-effort
picker, minutes per session, browser visibility) / stop. `--yes` and non-TTY
runs never see it. "Change settings" clears the resolved brain choice so the
picker actually asks again — the caching in `resolveBrain` was built to prevent
double-asking, and this is the one deliberate exception.

**Why:** the pipeline was fire-and-forget: by the time the aggregate revealed a
model was too weak or a run too short, the only option was starting over from
the command line. Redo re-runs a stage with new sessions — sessions stay
immutable.

**Files:** `src/cli.ts`

**Ref:** uncommitted

## 2026-09-04 — Cost accounting is out until the numbers are re-derived

**Decided:** every token, dollar and call-count figure is removed — `BrainUsage`
and its accumulation in `cli-brain.ts`, claude's `extractUsage`, the `usage` field
in `meta.json`, the `**Cost:**` line in `report.md`, `fmtTokens`, the pre-run
"stage 1 budget" banner, and the expert-panel call count.

**Why:** the figures are being recalculated from scratch. Leaving the old ones in
place while that happens means every report written in the meantime carries a
number nobody currently stands behind, and `report.md` is a durable artifact —
stages 2 and 3 read it back long after the run.

**This is parked, not rejected.** It reverses part of `e18bc89` and all of
`810cf44`, and both were good decisions for the reasons written there: a run with
no visible spend was the original problem, and a step is not one call because
`decide()` retries. Whatever replaces this needs to answer both again. No row in
"Tried and rejected" — nothing here was measured and found wanting.

**Kept:** journey duration and per-step `+Ns` offsets in `report.md`. They come
from event timestamps, not from usage reporting, and they were never cost figures.

**Files:** `src/brain/adapters/cli-brain.ts`, `src/brain/adapters/claude.ts`,
`src/log/report.ts`, `src/cli.ts`, `AGENTS.md`

**Ref:** uncommitted

## 2026-08-31 — The snapshot is not main-frame only, and the docs said it was

**Decided:** the safety section now says what is actually true: two structural
defences, not three. `scripts/verify-frames.mjs` proves the frame behaviour against
a real iframe on demand.

**Why:** verifying the frame-ref fix on a live page turned up a false claim that
had been in `AGENTS.md` since `11c5651`. It said the snapshot was main-frame only,
"so iframed Stripe/Adyen/Braintree card fields cannot be targeted at all."

Measured: `ariaSnapshot` descends into **every** frame, cross-origin included. A
`Card number` field inside a cross-origin iframe appears in the snapshot with a
targetable ref. The claimed ceiling never existed.

The protection itself holds — a framed card field, a framed "Pay now", and a
Luhn-passing string in any field are all still refused, verified directly against
`blockedAction`. What was wrong was the *reason*: that is the label matching
working, not a structural impossibility. The distinction matters because the docs
told you it was safe to point at a live commerce site.

This is the same failure `712adcd` fixed elsewhere — describing a best-effort guard
as mechanically guaranteed — and it survived because nobody had tested a framed
page. Hence the script.

**Also learned:** a fresh load of firecrawl.dev's pages produces no framed refs at
all, though four sessions used them mid-journey. Live pages are not a reliable way
to reproduce this; the checked-in script serves its own iframe instead.

**Files:** `AGENTS.md`, `DECISIONS.md`, `scripts/verify-frames.mjs` (new)

**Ref:** uncommitted

## 2026-08-31 — The expert panel reviews the persona who actually visited

**Decided:** `fix()` calls `getPersonaRegistry(s.meta.url)`, scoped to the site the
session belongs to. When the id still does not resolve it says so on stdout instead
of substituting quietly.

**Why:** the end-to-end run caught it in the output. The panel printed
`Expert panel: Skeptical Sam` for every session, whoever had visited. The registry
was built with no url, so a persona generated into `runs/<site>/personas/` was not
in it, and `?? PERSONAS.cold` swallowed the miss. Kenji is a warm, high-tech-comfort
data engineer at a 4,000-person Japanese enterprise; seven experts were told he was
a skeptical low-tech first-timer who skims and distrusts forms, and every
recommendation was calibrated to that. `FIXES.md` is the tool's actual deliverable,
so this was wrong output rather than a cosmetic slip.

The silent `??` fallback is what let it run for a full session before anyone noticed.
A missing persona now prints a warning naming the substitution and its consequence.

**Files:** `src/cli.ts`

**Ref:** uncommitted

## 2026-08-31 — Ref patterns must match framed refs, or signup forms disappear

**Decided:** every ref pattern matches `(?:f\d+)?e\d+`, not `e\d+`. One
`REF_ID_PATTERN` in `prune.ts` is the source; `driver.measure()` matches the same
shape.

**Why:** the end-to-end run found it. An element inside an iframe carries a frame
prefix — `f5e27`, not `e27` — and firecrawl.dev's signup form is framed. Four of
five sessions used framed refs, and Priya's mixed both in one session. The old
pattern produced two different wrong behaviours depending on the page:

- **only framed refs** — nothing measured, `visibility` empty, `splitByViewport`
  early-returns the whole tree. The viewport limit silently does not apply.
- **a mix** — `visibility` is non-empty so there is no early return, and every
  framed line fails the "is it visible" test and is dropped from the prompt. The
  persona cannot see the signup form at all.

The second is the dangerous one: a control vanishing is much worse than the limit
not applying, and it only happens on exactly the pages that matter — the ones with
a form in them.

**Known limit, accepted:** a framed element's rect and `innerHeight` belong to its
frame, so it reads as visible whenever it is visible *within* that frame, even if
the frame itself is scrolled off. Walking the frame chain would fix it; nothing
seen so far needs it, and the failure mode is a false "visible", which merely
restores the old behaviour for one element rather than hiding a real control.

**Files:** `src/browser/prune.ts`, `src/browser/driver.ts`

**Ref:** uncommitted

## 2026-08-31 — The step counter shows patience, not steps

**Decided:** the thinking line prints `spent + 1` of `patience_steps`.

**Why:** scrolls stopped drawing down patience, so the raw step number now runs
past the budget and the run printed `[9/8] thinking...`, which reads as a broken
counter. Patience is the number that means something to a reader.

**Files:** `src/session.ts`

**Ref:** uncommitted

## 2026-08-31 — "This site's personas" means the site's directory, nothing else

**Decided:** `siteOwnPersonas(url)` reads only `runs/<site>/personas/`. It is what
decides whether generation runs and what an unattended run queues.

**Why:** the first end-to-end run caught this. `prepareSitePersonas` and
`randomRunPlan` both defined "this site's set" as *everything in the registry that
is not a built-in preset* — which sweeps in the global `personas/` directory. So
`client-simulator firecrawl.dev --yes` queued ten machine-local personas built for
entirely different products (`cp-hunter-impatient`, `dana-whitmore-revops-head`)
and never touched the six generated for firecrawl.dev. Worse, `existing.length > 0`
was the check that skips generation, so any machine with a global `personas/`
directory would never generate a set for a new site at all.

**Rejected:** "not a built-in" as the definition. It is the tempting one — the
registry is already merged by then — and it is wrong in both directions: a
hand-written global persona counts as this site's work, and a site with none looks
like it has some.

The full registry still includes global personas, so hand-written ones remain
usable by name; only the *automatic* selection is scoped.

**Files:** `src/persona/load.ts`, `src/cli.ts`

**Ref:** uncommitted

## 2026-08-31 — The viewport limit is enforced, not just described

**Decided:** `driver.act()` refuses a target that was not on screen in the last
snapshot, with a message telling the persona to scroll to it first.

**Why:** `buildPrompt` only carries visible refs, but `aria-ref=` resolves against
the whole document and `act()` auto-scrolled to anything it was given. Refs are
sequential and appear in the rendered history, so a persona could name a footer
link it had never scrolled to and the driver would scroll down and click it —
making the viewport limit a suggestion. `712adcd` already corrected this exact
class of mistake elsewhere: do not describe a prompt-only rule as enforced.

An unmeasured ref is still allowed through — it is either an old snapshot with no
visibility data or a stale ref, and both fail honestly at click time.

**Files:** `src/browser/driver.ts`

**Ref:** uncommitted

## 2026-08-31 — A persona sees one viewport, not the whole document

**Decided:** `driver.snapshot()` measures where every ref sits relative to the
viewport. `buildPrompt` then shows only what is on screen, plus a headings-first
outline of what lies further down, without refs — you cannot click what you have
not scrolled to. Transparent and zero-size nodes are dropped outright. Scrolling
no longer draws down `patience_steps`, and a scroll's stuck-loop signature now
includes `scrollY`.

**Why:** measured on firecrawl.dev, which is 21 screens tall. The snapshot handed
the persona **776 refs; a visitor at the top of the page can see 37.** So a
persona could click a footer link at step 1 without ever scrolling, and read a
hero CTA and a legal link as equal peers — the largest visible element is
13,493× the area of the smallest, and the YAML renders them identically.

The suspicion that started this was invisible buttons. That turned out to be 2
elements out of 776, and covered elements were zero — Playwright's "receives
events" check already handles those. The real distortion was 93% below the fold.

**Measured after:** 774 refs → 40, prompt 63,977 → 6,150 chars (**90% smaller**),
at ~840ms per snapshot to resolve every ref. For scale, `e5d15ce` fought hard for
14% on the same page.

**Two things this broke, and how:**
- `stuckPattern`'s "same action 3×" rule. Working down a long page now means
  scrolling several times in a row, which it would have called a loop and killed
  every session. Folding `scrollY` into the scroll signature separates "moving
  down the page" from "wedged at the bottom" with no special case.
- The patience budget. ~14 scrolls to reach the bottom of a 12-step persona's
  page would have exhausted it halfway and filed a drop-off the site did not
  cause. Scrolling is looking around, not an attempt, so it is free — bounded by
  `MAX_FREE_SCROLLS` so a persona that only scrolls still terminates.

**Rejected:** screenshot-plus-coordinates, which is where this started. Playwright
already clicks with a real mouse at real coordinates *and* hit-tests first, so
model-estimated pixels would replace an exact target with a guessed one — and a
missed click reads as "this button is broken", manufacturing exactly the false
drop-off `11c5651` exists to prevent. It also costs an image per step and rules
out `opencode`, which has no vision (`readsFiles: false`).

Also rejected: taking the outline in document order. That filled all 15 slots
from one demo widget sitting just under the fold, and "Pricing" further down never
appeared. Headings get the slots first.

**Files:** `src/browser/driver.ts`, `src/browser/prune.ts`, `src/brain/prompt.ts`,
`src/session.ts`, `src/types.ts`

**Ref:** uncommitted

## 2026-08-31 — One command, and a site brief that gates on nothing

**Decided:** `client-simulator <url>` is the whole tool — read the page, write
`runs/<site>/SITE.md`, build personas into `runs/<site>/personas/`, visit, report,
fix. `--stop <stage>` ends it early, `--yes` silences every question, and the other
six subcommands became flags (`--report`, `--fix`, `--doctor`, `--list-personas`,
`--new-persona`, `--mailtest`). Prior knowledge is rationed by temperature:
**cold gets nothing, warm gets the arrival paragraph, hot also gets what it does,
what it costs, and how signup works.**

**Why:** `resolveRunPlan` returned an explicit `--persona` queue before it ever
reached the first-visit branch, so `--persona cold` silently skipped both the site
read and persona generation. A firecrawl.dev run did exactly that: Skeptical Sam
arrived knowing nothing, spent all 12 steps working out what the product was
("I'm still confused about what Firecrawl actually does for a regular person"),
and the run was filed as a GUARDRAIL — a generic persona failing, recorded as the
site failing. Reading the page is also the only way to build an ICP, so the scrape
had to stop being optional.

Temperature tiering is the part that makes this safe. Handing every persona the
brief would have fixed the confusion by destroying the signal: a cold persona who
knows what the product is has stopped being a first-time visitor, and whatever it
then fails to notice is no longer evidence about the page. The three temperatures
are three amounts of prior research, and that is most of what makes them behave
differently.

**Rejected:** Giving `readSite()`'s three fields to every persona equally — that
was the shape the code was already reaching for, and it is the version that
quietly invalidates cold runs. Also rejected: a second scrape inside
`generatePersonas`. The brief is cheaper and better context than a raw
accessibility dump of the same page, so it is passed through as `siteContext`.

**Removed:** `src/site/read.ts`. `ensureBrief` supersedes it.

**Files:** `src/site/brief.ts` (new), `src/cli.ts`, `src/persona/load.ts`,
`src/persona/generate.ts`, `src/brain/prompt.ts`, `src/types.ts`, `src/session.ts`

**Ref:** uncommitted

## 2026-08-30 — Every path that reads site-controlled text got hardened

**Decided:** Safety label matching covers es/pt/fr/de/it/nl/sv/ru/ja/ko/zh against
accent-stripped labels. The page snapshot's ```yaml fence is escape-proof. The
expert transcript is marked as data, not instruction. The MIME tag regex is bounded.
Flag validation moved ahead of the browser launch.

**Why:** A persona and the expert panel both read text the site under review writes,
and several paths trusted it further than they should. A non-English SSO button
walked past the guard. A page printing ``` closed the fence early, so whatever
followed read as harness instruction. `<[^>]+>` is quadratic on an unclosed `<` — a
256KB body at the fetch cap burned 33s of event loop mid-session. Separately,
`--brain` was never checked for existence, so a missing CLI launched a browser and
minted a mailbox before failing.

**Files:** `src/safety.ts`, `src/brain/prompt.ts`, `src/experts/`, `src/mail/mime.ts`,
`src/brain/picker.ts`, `src/cli.ts`, `src/doctor.ts`

**Ref:** `8f114d4`

## 2026-08-26 — Per-character inputs get real keystrokes, not fill()

**Decided:** `needsKeystrokes()` routes short-maxlength fields to one keypress per
character. Email screenshots that render to nothing are dropped.

**Why:** `fill()` sets the value in one shot, so a six-box OTP input keeps only the
first digit and the page's auto-advance never fires. Personas recovered by typing
one digit per step, burned a quarter of their patience doing it, and filed the
result as a fault of the site under test.

**Files:** `src/browser/driver.ts`

**Ref:** `7df266b`

## 2026-08-26 — IMAP is addressed by UID everywhere

**Decided:** Every read and move passes `{uid: true}`. Delivered mail stays visible
across later inbox checks. Body text always ships, rather than relying on a
screenshot. Cue-anchored alphanumeric codes are recognised.

**Why:** `search()` returns sequence numbers unless `{uid:true}` is passed, but
every read and move below it addressed messages by UID. `fetchOne` read by sequence
and got the right envelope; `download` read by UID and got nothing. So every message
arrived with a correct subject and an empty body, personas had no code to act on,
and they abandoned working login flows and reported the sites as broken. The same
mismatch in `destroy()` moved messages to Bin by UID using sequence numbers — on a
catch-all inbox that could trash unrelated mail.

**Files:** `src/mail/imap.ts`, `src/mail/mime.ts`

**Ref:** `d0db6d3`

## 2026-08-26 — Safety judges the action, not the URL

**Decided:** Personas may reach any page — pricing, billing, a full checkout —
because reaching the wall is the finding. The *action* is what gets refused: card
fields, anything passing Luhn, the payment-commit labels of the major platforms,
third-party auth including bare provider-icon buttons, enterprise SSO phrasing.

**Why:** The URL blocklist it replaced was wrong in both directions. It killed two
`deep-evaluator` sessions for opening `docs.modelcode.ai/support/billing-and-credits`
and `platform.experientiallabs.ai/docs/billing` — help articles — while a checkout
at a path lacking those substrings walked straight through.

**Rejected:** Blocking a bare "Subscribe". A newsletter CTA is far commoner than
Stripe's identically-labelled commit button, which cannot succeed without a card
anyway. Also deliberately allowed: "Purchase history", a "Donate" nav link,
"Create organization" — a false positive there manufactures a drop-off the
customer's site did not cause.

**Also:** a refusal does not end the session. The persona is told why and either
routes around it or walks out, which is the behaviour worth recording. The docs
state this as best-effort label matching, not a guarantee; the real ceiling is
structural (fresh context per session, `fill()` never pressing Enter, main-frame-only
snapshots).

> **Corrected 2026-08-31.** "Main-frame-only snapshots" was wrong — see the entry
> for that date. `ariaSnapshot` descends into every frame, cross-origin included,
> so a framed card field *is* targetable. The label guards still refuse it; the
> structural ceiling was two defences, not three.

**Files:** `src/safety.ts`, `src/session.ts`

**Ref:** `11c5651`

## 2026-08-26 — The saved video is the page the journey ended on

**Decided:** Save `this.page.video()`. Largest-clip survives only as a fallback for
a crash before first paint.

**Why:** `chooseRecording` picked the largest file, on the theory that the main
journey produces the most footage. It does not — a heavy animated landing page left
open in tab one outweighs the signup tab the persona actually finished in. Confirmed
on the lyzr.ai `tomas-lindqvist` run: the saved video's last frame was the lyzr.ai
homepage while step 14 was on `studio.lyzr.ai/auth/sign-up`.

**Rejected:** A duration check. 374s of video against a 344s journey passes fine —
only comparing frames against the step screenshots catches it.

**Files:** `src/browser/driver.ts`

**Ref:** `123cb85`

## 2026-08-26 — Snapshot pruning drops machine-only noise, and nothing else

**Decided:** One rule: drop COinS metadata and percent-encoded blobs no visitor
could read. Applied in `buildPrompt`, not `driver.snapshot()`.

**Why:** A citation-heavy page costs ~64k tokens per step. The rule takes it to
54,844 with all 1,754 refs kept, and three captured ordinary pages come out
byte-identical. It lives in `buildPrompt` because `verifyGoal` must judge the real
page — a truncated confirmation becomes a false drop-off in the report.

**Rejected:** Two more rules, built and then deleted. Truncating long text removed
the tail of consent copy, where "your card will be charged $49 per month" lives —
the exact thing `presets.ts` personas exist to notice. Dropping `#fragment` link
targets anonymised links whose only identity was that fragment. Together they saved
~7% of one page and 0% of every other, carrying all the risk.

**Files:** `src/browser/prune.ts`, `src/brain/prompt.ts`, `fixtures/`

**Ref:** `e5d15ce`

## 2026-08-26 — Persona brains are sandboxed; email HTML renders in a throwaway context

**Decided:** opencode personas run under `OPENCODE_CONFIG` permission denies, codex
under `--sandbox read-only`. Untrusted email HTML renders with JS disabled and all
network aborted. Brain CLIs get an env allowlist instead of full inheritance.
`loadSessions` zod-validates `meta.json` and `session.jsonl`.

**Why:** Only claude personas were restricted. The popup-hijack path through email
rendering was live. Hostile `meta.json` shapes crashed `report`/`fix` instead of
skipping with a warning.

**Gotcha worth keeping:** `extendEnv: false` is mandatory — execa v9 silently
re-merges the parent env without it.

**Files:** `src/brain/adapters/`, `src/browser/driver.ts`, `src/log/aggregate.ts`

**Ref:** `712adcd`

## 2026-08-26 — Runs record cost, duration, and which pages they reached

**Decided:** The claude adapter accumulates tokens and cost across a session
(retries included — they are real calls) into `meta.json` and the report header.
Reports show total journey time and per-step `+Ns` offsets. A new section lists each
distinct URL with the step and elapsed time it was first reached.

**Why:** `claude -p --output-format json` returns a usage block on every call and
`extractText` was discarding all of it. Every event already carried a timestamp and
nothing surfaced it. A page that takes eight steps to find is a finding in itself —
on lyzr.ai only 2 of 10 personas ever reached `/control-plane/`.

**Rejected:** Showing zero for opencode and codex. They do not report usage, so
`reported` stays false rather than displaying a misleading number.

**Files:** `src/brain/adapters/claude.ts`, `src/log/report.ts`, `src/log/aggregate.ts`

**Ref:** `e18bc89`

## 2026-08-26 — Recordings show a cursor

**Decided:** Inject a tracking dot and a red click-ripple as an init script, so it
survives navigation and reinstalls in every frame. Only when a `videoDir` is set.

**Why:** Playwright drives a real mouse but renders no pointer, so the videos gave
no clue where a persona was looking or clicking.

**Constraint that shaped it:** everything injected is `aria-hidden` with
`role=presentation` and `pointer-events: none`, verified absent from the
accessibility snapshot the persona reads and unable to intercept a click meant for
the page.

**Files:** `src/browser/cursor.ts`, `src/browser/driver.ts`

**Ref:** `42c73ca`

## 2026-08-26 — The stage-1 call budget is shown before a run

**Decided:** Print two numbers — the step count, and 3× it.
`MAX_DECIDE_ATTEMPTS` is exported from `cli-brain.ts` and shared by the retry loop,
the backoff guard, the error message and the banner, so they cannot drift apart.

**Why:** A ceiling already existed structurally (`MAX_RUNS` personas,
`patience_steps` capped at 50 by the schema). It was only invisible. Two numbers
rather than one because a step is normally a single call, but `decide()` retries a
malformed reply and each attempt is its own CLI spawn — one optimistic number
understates spend by ~3×, one pessimistic number is wrong on nearly every run and
gets ignored.

**Rejected:** A second cap, a flag, or a config knob. Nothing was added; only the
existing worst case was surfaced.

**Files:** `src/cli.ts`, `src/brain/adapters/cli-brain.ts`

**Ref:** `810cf44`

## 2026-08-26 — One malformed field stops discarding a whole expert section

**Decided:** Scores are clamped to 0–10. Missing recommendation priorities default,
and only entries carrying neither a problem nor a fix are dropped. Renders are
exported so they can be tested directly.

**Why:** Both failures were caught by the caller's try/catch and logged as "expert
failed", so a section vanished silently rather than degrading.
`'░'.repeat(10 - Math.round(score))` throws `RangeError` when a model answers
outside the range it was given, losing the entire scorecard.
`r.priority.toUpperCase()` threw on a missing field, taking all six recommendations
with it.

**Files:** `src/experts/scores.ts`, `src/experts/ux.ts`

**Ref:** `24de073`

## 2026-08-26 — Mail is read decoded, not as raw MIME

**Decided:** Ask the server for the decoded body part (`bodyStructure` + `download`)
— imapflow already decodes, so no new dependency. `src/mail/mime.ts` adds a part
picker (largest candidate, attachments skipped) and a raw-MIME fallback decoder,
capped at 256KB per body. Codes rank by a cue word appearing before the number.

**Why:** `fetchNew` ran the code and link regexes over raw RFC822 source. Most
transactional mail is base64 or quoted-printable, so base64 HTML found nothing and
quoted-printable was worse than nothing — a soft line break split `4839=\r\n20` and
the persona typed a wrong 4-digit code. Either way the run burns its `otp_patience`,
abandons, and reports that the site's verification email never sends: a false
accusation from a tool whose job is telling you what is broken.

**Knock-ons from the same root cause:** `emailScreenshot` was handed raw MIME and
rendered headers and base64 gibberish. When no code was found the persona was shown
an excerpt of `Received:` and `Delivered-To:` headers — useless to it, and it leaked
mail infrastructure into the prompt.

**Files:** `src/mail/imap.ts`, `src/mail/mime.ts`

**Ref:** `ce58e83`

## 2026-08-26 — Publishing uses an allowlist, not an ignore file

**Decided:** `package.json` `files` lists what ships. `npm pack` reports 38 files —
no secrets, no tests, bin present.

**Why:** An `.npmignore` added earlier the same day made npm stop consulting
`.gitignore`, so `npm pack` listed `.env` (IMAP password, API key), both state files,
and `fixtures/`.

**Rejected:** The `.npmignore` blocklist. An allowlist is leak-safe by construction;
a blocklist is only as good as memory.

**Files:** `package.json`

**Ref:** `02dfb58`

## 2026-08-26 — Oscillating loops are caught, and events stop vanishing from JSONL

**Decided:** `stuckPattern` detects cycles up to length 3, with repetition
thresholds tuned so ordinary exploration cannot trip it. The JSONL write moved to
the end of the step.

**Why:** `isStuck` only matched three identical consecutive actions, so an A-B-A-B
ping-pong ran until patience ran out, paying for a full page snapshot every step.
And the line was written before the email-override and action-failure handling ran,
so neither reached the file — since `fix` reloads from JSONL, the expert panel never
saw that an action had failed.

**Files:** `src/session.ts`

**Ref:** `b64797d`

## 2026-08-26 — Brains are per-session; runs are filed by site and date

**Decided:** Adapters became factories — each session gets its own brain, every call
self-contained. Tools restricted by role. Calls run outside the repo, with
`--add-dir` opting the session directory back in. Retries reformat the bad reply
instead of resending the step prompt. Runs live at
`runs/<site>/<date>/<time>-<persona>/`, with per-site `AGGREGATE.md`.

**Why:** Adapters were module-level singletons holding a persistent CLI session, so
every persona in a run shared one conversation and persona 2 was no longer a
first-time visitor. Running inside the repo meant the CLI loaded this project's own
`AGENTS.md` into a persona that is supposed to know nothing about it. A funnel
mixing several websites was not meaningful.

**Measured:** 20,421 → 14,950 tokens of fixed overhead per call. Retry prompts are
~94% smaller.

**Rejected:** `--resume`/`-s`. Dropping it is what keeps context from growing
without bound across a run.

**Files:** `src/brain/`, `src/runs.ts`, `src/cli.ts`, `src/browser/driver.ts`

**Ref:** `646556a`

## 2026-08-26 — A unit suite for the pure logic stages 1–3 depend on

**Decided:** Node's built-in runner, no new dependency, no LLM or network calls.
Covers run-directory layout and discovery, the stuck-loop detector, JSON extraction
from noisy CLI output, video-clip selection, MIME decoding, expert rendering,
persona loading, prompt building, and aggregation.

**Why:** These are the paths every stage sits on and none of them were covered.
Writing the tests caught real bugs: a path-traversal in `siteSlug` (`new URL()`
parses `../../etc/passwd` with host `..`, which the character filter preserved, so
`sessionPath` would have written outside `runs/`); a quoted-printable decoder using
`String.fromCharCode` per byte that mangled UTF-8; and code ranking that still
preferred an order number over the verification code.

**Worth copying:** the prompt-tiering assertion is deliberately split-and-assert-
absence. An earlier version used a top-level alternation that reduced to "both
strings appear somewhere" and would have passed a regression collapsing the tiers.

**Files:** `src/**/*.test.ts`

**Ref:** `73ec76e`, `8e74d0b`, `618ffb2`

## 2026-08-26 — personas/ is machine-local

**Decided:** Gitignored. `load.ts` recreates the directory on demand and falls back
to the built-in cold/warm/hot presets when it is absent.

**Why:** Personas are generated per-machine by `personas generate` or hand-written
for one investigation, so a shared copy is noise for everyone else.

**Files:** `.gitignore`, `src/persona/load.ts`

**Ref:** `d0ba76c`, `3f303d1`

## 2026-08-25 — Brains never invent contact details

**Decided:** Any email the brain types is overridden with the assigned ephemeral
mailbox. The prompt carries an explicit never-invent-email rule.

**Why:** `runSession()` stopped receiving the mailbox after a headless-field
cleanup, so every session since had run mailless and brains invented addresses to
fill forms. The override is the trust boundary; the prompt rule is the belt.

**Files:** `src/session.ts`, `src/brain/prompt.ts`, `src/cli.ts`

**Ref:** `72f5a5b`

---

## Earlier

| Date | What | Ref |
|---|---|---|
| 2026-08-26 | Version bumped to 0.3.0 — `package.json` still said 0.1.0, with 11 commits and a breaking `runs/` layout change since "v0.2" | `6d4b23d` |
| 2026-08-26 | Interactive brain/model/effort picker and zero-arg wizard; menus probe the CLI live instead of hardcoding lists; model/effort recorded in `meta.json` | `c4dae96` |
| 2026-08-25 | `--model` flag pins any model per brain; the default stays the CLI's own | `2b7534b` |
| 2026-08-25 | Emails render as screenshots so brains read any OTP format; brain retry with backoff; hot patience 20→26 (split-box digit entry eats steps) | `01c286f` |
| 2026-08-25 | Popup/new-tab following made crash-safe on revert | `2caa1ff` |
| 2026-08-25 | Renamed to client-simulator; codex brain added; README rewritten shorter | `2789dc9` |
| 2026-08-25 | Testing-your-own-site checklist: bot blockers, mail allow-list, known walls | `6097c4a` |
| 2026-08-25 | First release: synthetic client agents that test website onboarding | `8c22abd` |

---

## Tried and rejected — do not re-propose

| Idea | Why it is dead | Ref |
|---|---|---|
| Resolving a persona without its site (`getPersonaRegistry()`) | Site-generated personas are absent, `?? PERSONAS.cold` swallows the miss, and the expert panel advises on the wrong person entirely | 2026-08-31 |
| Matching refs as `e\d+` | Misses framed refs (`f5e27`); on a page with both, every control inside the iframe is dropped from the prompt — and signup forms are routinely framed | 2026-08-31 |
| Defining "this site's personas" as "not a built-in" | Sweeps in the global `personas/` directory: a new site never generates a set, and unattended runs queue personas built for other products | 2026-08-31 |
| Letting `act()` resolve any ref on the page | `aria-ref=` hits the whole document, so a persona could click a footer link it never scrolled to — the viewport limit has to be enforced, not described | 2026-08-31 |
| Screenshot + model-estimated click coordinates | Playwright already clicks with a real mouse and hit-tests; guessed pixels would replace an exact target with an approximate one, and a miss reads as a broken button | 2026-08-31 |
| Building the below-fold outline in document order | One dense widget under the fold took all 15 slots; headings further down never appeared | 2026-08-31 |
| Giving every persona the site brief | A cold persona that knows what the product is has stopped being a first-time visitor; what it then fails to notice is no longer evidence | 2026-08-31 |
| A second scrape inside `generatePersonas` | The brief is cheaper and better context than a raw a11y dump of the same page — pass it as `siteContext` | 2026-08-31 |
| URL-substring blocklist for payment pages | Wrong in both directions: killed two sessions on billing *help articles*, let a checkout at a plain path walk through | `11c5651` |
| Blocking a bare "Subscribe" | A newsletter CTA is far commoner than Stripe's identically-labelled commit, which cannot succeed without a card | `11c5651` |
| Truncating long text in the snapshot | Deleted the tail of consent copy, where "your card will be charged $49 per month" lives | `e5d15ce` |
| Dropping `#fragment` link targets | Anonymised links whose only identity was the fragment; ~7% on one page, 0% on every other | `e5d15ce` |
| Pruning inside `driver.snapshot()` | `verifyGoal` must judge the real page, or a truncated confirmation becomes a false drop-off | `e5d15ce` |
| Largest video file = the main journey | A heavy animated landing page outweighed the signup tab the persona finished in | `123cb85` |
| A duration check to catch the wrong video | 374s video against a 344s journey passes fine; only frame comparison catches it | `123cb85` |
| `.npmignore` to keep secrets out of the package | Made npm stop consulting `.gitignore`; `npm pack` then listed `.env` | `02dfb58` |
| A second step-cap flag or config | The ceiling already exists structurally; only surfacing it was needed | `810cf44` |
| Showing token cost for opencode/codex | They do not report usage; `reported: false` beats a misleading zero | `e18bc89` |
| `--resume`/`-s` on brain CLIs | Persistent sessions are what let context grow without bound across a run | `646556a` |
| Committing `personas/` | Generated per-machine; `load.ts` recreates it and falls back to presets | `d0ba76c` |
| A memory provider interface | Removed from the roadmap | `PLAN.md` |
