# Beta E2E (browser)

Answers one question before a promotion: **would a user hitting the beta fleet
right now be able to sign in, load the app, and get a working agent turn?**

Run it from the Actions tab — **Beta E2E (browser)** → _Run workflow_. Green
means promote; red means look before you promote.

The assertions come from what people actually reported breaking in
`#product-agent-native-feedback`: Google sign-in failures, sign-in loops, apps
that will not load, agent turns that end in `ERROR ID:`, a composer stuck on
"Thinking", lists that render empty, and Slides losing its connection to
Analytics.

## Lanes

| Lane       | Gates a promotion | Credentials          | Model spend               |
| ---------- | ----------------- | -------------------- | ------------------------- |
| `public`   | yes               | none                 | none                      |
| `authed`   | yes               | session + OpenAI key | ~1 luna turn per chat app |
| `journeys` | yes               | session              | none                      |
| `advisory` | no                | none                 | none                      |

`public` is the one that always runs and needs nothing set up. It already
covers the most-reported failures, because most of them are visible before a
user finishes signing in.

`advisory` reports real findings that do not stop a user — beta being
indexable, third-party pixels that reject beta hosts, beta sharing a database
with production. It never fails the job. If something there starts blocking
users, move it into a gating lane rather than loosening the assertion.

## Running locally

```bash
pnpm e2e:beta --project=public
```

```bash
BETA_E2E_APPS=slides,analytics pnpm e2e:beta --project=public
```

`pnpm typecheck:e2e` typechecks the suite. `e2e/` is not a pnpm workspace
package, so the repo-wide `pnpm typecheck` does not reach it — the workflow
runs this explicitly before spending anything.

## Enabling the authenticated lane

Two secrets, one of them a one-time manual step.

**1. A session.** Beta accepts Google OAuth only, and CI must never drive a
credential form, so a human signs in once and CI replays the result.

Use a **dedicated e2e account**, not a personal one. The run writes to that
account (see _What this run leaves behind_ below), and CI artifacts contain
traces of its authenticated requests, so its session is effectively shared with
anyone who can read this repository.

```bash
pnpm e2e:beta:capture
```

A browser opens per app. Sign in with the account this suite should run as —
prefer a dedicated e2e account over a personal one. The command prints the
values for `BETA_E2E_EMAIL` and `BETA_E2E_SESSION_TOKENS`. These are live
sessions for that account: treat them as credentials, and re-run the command
every 30 days when they expire.

**2. A dedicated OpenAI key.** Create a new key with its own spend limit and
set it as `BETA_E2E_OPENAI_API_KEY`. The suite installs it at **user** scope
against the e2e account only, so every turn it runs bills a credential nobody
else uses and the spend is attributable.

It must not be a site-level `OPENAI_API_KEY` on a beta Netlify site — that
would bill every visitor's turns to this key, and the repo's Netlify env guard
rejects it anyway. It must not be written at org scope either, which would
change the default for everyone in the org.

### Repository secrets

| Secret                    | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `BETA_E2E_EMAIL`          | The identity every authenticated spec asserts it is running as           |
| `BETA_E2E_SESSION_TOKENS` | Per-app map from `e2e:beta:capture`, e.g. `{"slides": "…", "chat": "…"}` |
| `BETA_E2E_OPENAI_API_KEY` | Dedicated, separately-limited key for agent turns                        |

## Things that behave the way they do on purpose

**One token per app.** A framework session is a row in that app's own database,
so a token minted on Slides resolves on Slides. Most beta apps share a database
with their production twin, and several share one with each other, so a single
token does happen to resolve on more than one host — but which ones is an
accident of current infrastructure, not a contract. `e2e:beta:capture` emits a
per-app map for that reason. The `{"*": "…"}` wildcard exists as an escape
hatch for a one-app run; it is not a fleet-wide credential.

**Missing credentials fail; they never skip.** If the authenticated lane is
asked for and a secret is absent or a session has expired, global setup throws
before any spec runs. An authenticated assertion evaluated against a
signed-out page is not a weaker test, it is a false one — and this repo has
that exact bug in two template global-setups today, which warn and continue as
a guest.

**The model is read back off the wire.** Seeding `gpt-5.6-luna` into
localStorage is a wish until something checks it. Every agent-chat POST is
inspected and the run fails if anything other than luna was billed, including
a request that carried no model field at all and therefore fell back to the
app's default.

**Certificate errors stay visible.** `ignoreHTTPSErrors` is never set, because
"the connection isn't private" was a real report and only a browser that still
validates certificates can see it.

**Google checks follow what each app renders.** The shared login document ships
Google markup for every app and hides it when the provider is not configured,
so asserting unconditionally would fail CRM and Macros, which legitimately
offer password and Supabase sign-in instead. The suite reads the rendered page
and only holds an app to the Google contract when it shows a Google button.

**A condition production already has is not a promotion blocker.** When a beta
host fails the A2A configuration check, the same probe runs against its
production twin. If production is in the same state it is annotated as
pre-existing rather than failing the gate — this suite answers "would
promoting make things worse", and a red run has to mean something.

## Two things to know about the fleet

**Most beta apps share a database with production.** Measured on 2026-08-20,
13 of 16 beta hosts report the same database as their production twin; only
`crm`, `design`, and `chat` are isolated. Beta is a separate _build_, not a
separate _environment_. The advisory lane asserts the isolation that does not
exist yet, so the day it changes is visible.

### What this run leaves behind

The specs create no app fixtures — no decks, documents, or forms — but an
authenticated run is not read-only, and most of what it writes lands in a
production database:

- **A session row per app**, when a captured token is exchanged for that host's
  cookie. Expires with the 30-day session.
- **A user-scoped OpenAI credential**, on the apps that take a paid turn
  (`chat`, `slides`, `analytics`, `content`, `dispatch`). It is written on every
  authed run, it **overwrites** whatever OpenAI key that account already had,
  and nothing removes it afterwards. This is the strongest single reason the
  account must be a dedicated one.
- **Agent threads, runs, and messages** for each turn taken, under the e2e
  account.
- **Token usage rows** attributed to that account.

None of it is confined to a beta-only lane, because for 13 of 16 apps no such
lane exists.

**A2A on beta calls production.** First-party peer URLs come from the template
registry, which stores one production URL per app with no beta-aware branch.
`beta.slides` delegating to "analytics" reaches **production** Analytics. The
A2A spec is named for that, and a green result there does not clear beta
Analytics.

## Adding a host or an app

The host list is read from `scripts/netlify-beta-sites.json`, the same file the
deploy workflow publishes from, so a new beta site is swept as soon as it is
deployable. Apps that get a paid agent turn are listed explicitly in
`lib/fleet.ts` (`CHAT_APPS`) — that costs money per run, so it stays a decision
someone makes.

`pnpm guard:beta-e2e-suite` enforces the parts the suite cannot check itself:
the fleet stays derived rather than duplicated, non-beta hosts stay refused,
the budget model stays luna, and the workflow stays manual.
