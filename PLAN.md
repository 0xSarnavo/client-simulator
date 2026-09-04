# PLAN.md

What is settled, what is next, and what has been ruled out.

[AGENTS.md](AGENTS.md) is how to run and change the tool. [DECISIONS.md](DECISIONS.md)
is why each past choice was made. This file is only the forward view — if you are
about to propose work, read the two lists below first.

---

## Settled

Shipped and not up for renegotiation without a reason written into DECISIONS.md.

| Area | Note |
|---|---|
| Five stages, one command | `site → personas → visit → report → fix`, `--stop` ends early; interactive runs get a continue/redo/settings/stop gate between stages |
| Site brief + per-site persona sets | `runs/<site>/SITE.md`, `runs/<site>/personas/` (default set: 10) |
| Bot-wall scout | the brief's scrape detects Cloudflare/captcha walls, writes `runs/<site>/BLOCKED.md`, and runs skip the site until it is deleted or `--plan` re-checks |
| Flow under test | stated intent → reviewed checkpoints in `runs/<site>/FLOW.md` → per-session scoring → funnel in the aggregate. Optional; no flow file means wander |
| Concurrent visits | queued personas run at once, each fully isolated; output lines tagged by persona id |
| Time budget | `--time` minutes per session (default 20), waiting on mail/`wait` excluded |
| Risk framing | reports warn what real visitors *could* hit; they never claim measured behaviour |
| Temperature is prior knowledge | cold knows nothing, warm the arrival context, hot the specifics |
| A persona sees one viewport | plus a headings outline; scrolling costs no patience |
| Sessions are immutable evidence | reports and expert advice regenerate from them |
| Ephemeral mailboxes | OTP codes and magic links, per run, destroyed after |
| Brains | claude, opencode, codex — any brain, any stage |
| Safety | payment and third-party auth, by action not URL. Best-effort, not a guarantee |
| Expert panel | 7 experts, one `FIXES.md` per session |

## Next

In order. Nothing here is committed to; each is stated as the problem, because
the solution deserves an argument when it is picked up.

**1. Findings do not survive across sessions.** Every expert reviews one session
alone, so a wall that stopped five of six prospects is described five separate
times and never once as a pattern. The flow funnel now shows *where* prospects
fall out across sessions, but nothing yet reasons about *why* across them. This
is the gap between "six reports" and "one answer", and it is the most valuable
thing left.

**2. The wizard and the stage gates have never been driven by a human.** The
zero-argument guided flow, the flow-checkpoint review gate, and the
continue/redo/settings menus all compile and are unverified interactively. They
need someone at a terminal, once.

**2b. Costing needs re-deriving.** All token/cost accounting was removed
2026-09-04 (see DECISIONS.md — parked, not rejected). Whatever replaces it must
again answer: spend was invisible before it existed, and a step is up to 3 calls
because decide() retries.

**3. Mobile is a flag, not a trait.** `--mobile` applies to a whole run. Real
traffic is mixed, and whether a prospect is on a phone is a fact about who they
are, not about the run.

**4. Frames are measured in their own coordinate space.** An element inside an
iframe is judged against the frame's viewport, so it reads as visible when the
frame itself is scrolled away. Walking the frame chain fixes it. No page seen so
far needs it.

## Ruled out

Full list with evidence: [DECISIONS.md → Tried and rejected](DECISIONS.md#tried-and-rejected--do-not-re-propose).
The two that get re-proposed most:

- **Screenshots plus model-estimated click coordinates.** Playwright already
  clicks with a real mouse at real coordinates and hit-tests first. Guessed pixels
  trade an exact target for an approximate one, and a missed click reads as a
  broken button — the tool would invent drop-offs.
- **Returning-visitor memory.** Personas that recall previous runs. Cut during
  refinement; revisit only if real use demands it.
