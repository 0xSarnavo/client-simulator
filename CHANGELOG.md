# Changelog

Every user-visible change gets a line under **Unreleased** in the same commit.
Cutting a release moves that block under a version heading, bumps `package.json`,
tags `v<version>`, and publishes the same text as a GitHub Release.

## Unreleased

**Rebrand to Leakdown.** The bin is `leakdown` (was `client-simulator`).
Env vars are `LEAKDOWN_*` — `LEAKDOWN_IMAP_HOST/USER/PASS`,
`LEAKDOWN_MAIL_DOMAIN`, `LEAKDOWN_ORDERS_URL/TOKEN` — with the old
`CLIENTSIM_*` names still working for one minor with a deprecation
warning. Machine-local state moved to `.leakdown-state.json`.
`package-lock.json` is committed, so installs are reproducible.

## 0.5.0 — 2026-09-14

**Where runs land.** One folder per CLI invocation: `runs/<site>/<date>/<time>/`,
with three seats inside — `wide/`, `verify/`, `deep/` — and one folder per model
in each. Every run writes `RUN.md` (seat, model, sessions, exits, tokens,
minutes), `AGGREGATE.md`, `DETAIL.md`, and, after `--ladder`, `VERIFIED.md`
(the verifier's panels) and `REPORT.md` (the writer's). The site level keeps
`SITE.md`, `MAP.md`, personas, and a copy of the newest run's five files.
Sessions from any older layout are still found.

**Getting around.** `--history [site]` lists runs with their one number.
`--report`, `--fix` and `--replication` take a site name (its newest run) or
`site/date/time`. A run ends by printing the one number and the first wall.
The wizard leads with the ladder and picks a run before a session. `--help`
opens with the three commands people run.

**Runs.** Every run re-crawls the site once and asks whether to rebuild the brief
and personas when the page list changed; `--no-map` skips it. `--ladder` resumes
only an unfinished ladder run from the same day. The verifier's panels go to
`verify/<model>/`, not into the sessions it reviewed. `--random <n>` replaces
`--runs <n>` (the old spelling still works). `--by-model` is gone: per-model
reports are always written.

**Personas.** Generated prospects and the three presets carry one-word,
lesser-known Greek or Roman mythological names (Momus, Egeria, Felicitas), so a
report never reads as if it quotes a real person.

**Fixed.** `--wide`'s value could be read as the site URL. A stray dash at the
start of a prompt no longer trips the claude CLI.

**Website** (deployed separately, not in this repo): privacy and terms pages, a
strict Content-Security-Policy, a real 404, robots and sitemap, corrected form
copy, and a measured note that Railway puts the real client address first in
`x-forwarded-for`.

## 0.4.0 — 2026-09-14

`map` stage (crawler's view of the site, broken links, pages nobody found), the
one-page `AGGREGATE.md` with `DETAIL.md` behind it, mechanical page checks beside
every persona, the mail watchdog (probe before every run, All Mail scanning,
unverified-verdict warnings), website orders (`--orders`, `--order`),
`analytics.json` calibration, the cached system prompt, `--ladder`, and the
alpha hardening: Chromium checked live, patience follows the flow, a usage limit
stops the queue and names itself.

## Earlier

`--goal` pass/fail runs for CI, `--mailtest` with staggered probes, log
replication, shareable PDFs, per-model funnels, stage banners and progress bars,
the expert panel in parallel, and the guard that never finishes booking a
meeting. See `DECISIONS.md` for the why behind each.
