# Beta E2E (browser)

Answers one question before a promotion: **would a user hitting the beta fleet
right now be able to sign in, load the app, and get a working agent turn?**

## Running it

GitHub → **Actions** → **Beta E2E (browser)** → **Run workflow**. Green means
promote; red means look before you promote.

Or from a terminal:

```bash
gh workflow run beta-e2e.yml --ref main -f apps=all -f lane=public
```

To run the authenticated Design interaction lane only:

```bash
gh workflow run beta-e2e.yml --ref main -f apps=design -f lane=authed
```

| Input        | Default         | What it does                                                                                                                           |
| ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps`       | `all`           | Restrict to specific beta apps, e.g. `slides,analytics`. An unknown or empty value fails the run rather than silently testing nothing. |
| `lane`       | `public+authed` | `public` skips everything needing credentials or spend.                                                                                |
| `key_source` | `dedicated`     | Which OpenAI credential the agent turns bill — see below.                                                                              |
| `grep`       | none            | Only run tests whose title matches.                                                                                                    |

The `public` lane needs no secrets, so it works today with no setup.

It is sharded one host per runner. A page load against a beta host costs 1-2s
from a laptop and 20-40s from a GitHub runner, because the fleet sits behind one
CDN that throttles bursty datacenter traffic — on a single runner the sweep took
~28 minutes. Sharding makes the fleet cost the slowest single host and spreads
the requests over sixteen source addresses: measured 1704s to 437s. Cross-host
comparisons live in a separate `fleet` lane, because inside a shard they would
compare a set of one host and pass having checked nothing.

### How a run is laid out

The lanes are independent, so they overlap instead of queueing. `discover` and
`gate` start together. `gate` typechecks the suite and runs every
`e2e/beta/lib/*.spec.ts` helper test once, instead of once per job. The public
shards (at most 8 at a time), `fleet`, and `advisory` start as soon as
`discover` is done; the authenticated shards start when `gate` passes (at most
5 at a time). The authenticated lane is one job per slot, 12 in all, so a hang
or failure in one place is isolated and named:

| Slot                                       | Project                | Tests                                                                   | Job limit / `globalTimeout` |
| ------------------------------------------ | ---------------------- | ----------------------------------------------------------------------- | --------------------------- |
| `chat-slides`                              | `chat` (slides)        | chat, A2A, realtime (10 idle minutes), reliability                      | 30 / 27 min                 |
| `chat-analytics`, `chat-chat`              | `chat` (that app)      | chat, reliability (5 scenarios, ~8 turns)                               | 30 / 25 min                 |
| `chat-content`, `chat-dispatch`            | `chat` (that app)      | chat, reliability (1 scenario)                                          | 20 / 15 min                 |
| `journeys-session-1`, `journeys-session-2` | `journeys-session`     | `[journey] [session]`, 13 tests split by `--shard=1/2`, `2/2`           | 30 / 25 min                 |
| `journeys-credentials`                     | `journeys-credentials` | `[credentials]` (12) and `[settings-keys]` (3)                          | 30 / 25 min                 |
| `journeys-flows`                           | `journeys-flows`       | `[slides-import]`, `[forms]`, `[design-systems]`, `[dispatch-apps]` (7) | 30 / 25 min                 |
| `journeys-core`                            | `journeys-core`        | the original 38 journeys                                                | 20 / 15 min                 |
| `design`                                   | `design`               | editor interactions and culling                                         | 15 / 11 min                 |
| `registry`                                 | `registry`             | per-app registry checks                                                 | 10 / 7 min                  |

The journeys used to be one slot of ~75 serial tests with a 15 minute limit. A
spec file belongs to exactly one project (`journeys-core` takes every file under
`specs/apps` that no other journeys project claims, so a new spec lands in a
slot by default), and `lib/suite-partition.spec.ts`, which the `gate` job runs,
lists what every slot selects and fails unless the slots cover each project's
tests exactly once. `pnpm guard:beta-e2e-suite` fails on a project no slot runs,
a duplicated slot, or a shard set that is not exactly `1/m` through `m/m`.

Only the `chat-*` slots write the e2e account's user-scoped OpenAI key, each on
its own host, so no host's key is written twice at once (hosts that share a
database can still see two identical writes in the same minute; the value is the
same). The `journeys-credentials` checks assume the chat lane has installed that
key on `chat`, `slides`, `analytics`, `content` and `dispatch` at least once; it
persists between runs, but a brand-new account fails them with a message that
says so. Quiet-pool wall time is about 30 minutes; it was one to three and a
half hours when everything ran in a chain.

A narrowed dispatch (an `apps` list or a `grep`) can leave a slot with nothing
to run. That slot says so and skips its credentialed setup; a full-fleet run
with an empty slot fails instead, because it means the partition broke.

Every job has a `timeout-minutes` sized from observed runtimes. Inside it,
Playwright gets a `globalTimeout` a few minutes shorter
(`BETA_E2E_GLOBAL_TIMEOUT_MINUTES`), so a hung run ends with a reported failure
and a `results.json` instead of a job killed by its timeout, which GitHub
reports as "cancelled" with no test output. Global setup bounds each host at 150
seconds, bounds the in-page OpenAI key install with abort signals, logs a
`[beta-e2e]` line before every host's session bootstrap and key install (so a
hang names its host and step), and stops after three hung hosts. CI also stops a
slot after 8 failing tests (`maxFailures`), so a broad regression ends in
minutes. Concurrency is per kind of run: the production pre-flight (`public`)
and the signup canary no longer queue behind a scheduled authenticated run.

Each slot uploads one artifact named `beta-e2e-<lane>-<slot>-<run id>`
(`beta-e2e-public-slides-…`, `beta-e2e-authed-chat-slides-…`,
`beta-e2e-fleet-…`) holding `playwright-report/<slot>/` (the HTML report and
`results.json`) and `test-results/<slot>/` (failure screenshots and
`error-context.md` page snapshots).

The same suite also runs automatically from **Beta E2E (scheduled)** every six
hours (`0 */6 * * *`) with the public, authenticated, journey, and advisory
lanes. The scheduled workflow also has a manual dispatch entrypoint for checking
the reporter without waiting for the next cadence. What it reports, and where,
is under [Reading a failure report](#reading-a-failure-report).

The assertions come from what people actually reported breaking in
`#product-agent-native-feedback`: Google sign-in failures, sign-in loops, apps
that will not load, agent turns that end in `ERROR ID:`, a composer stuck on
"Thinking", lists that render empty, and Slides losing its connection to
Analytics.

## Lanes

| Lane                                                                          | Gates a promotion | Credentials          | Model spend                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `public`                                                                      | yes               | none                 | none                                                                                                                 |
| `registry`                                                                    | yes               | session              | none                                                                                                                 |
| `chat`                                                                        | yes               | session + OpenAI key | ~19 luna turns per full run (chat and Analytics take 8 each, the others 1), plus a Slides A2A turn and realtime edit |
| `journeys-core`, `journeys-session`, `journeys-credentials`, `journeys-flows` | yes               | session              | none                                                                                                                 |
| `design`                                                                      | yes               | session              | none                                                                                                                 |
| `advisory`                                                                    | no                | none                 | none                                                                                                                 |

`public` is the one that always runs and needs nothing set up. It already
covers the most-reported failures, because most of them are visible before a
user finishes signing in.

The workflow's `authed` lane runs the authenticated projects above as separate
jobs (chat is one job per app), so a provider failure cannot hide a registry,
journey, or Design editor regression. The `design` project drives the real
beta editor and covers layered fill ordering plus multi-selected text style,
undo, and reload persistence.

The `journeys-core` project includes `specs/apps/settings-navigation.spec.ts`: in
Analytics, Brain, Clips, Design, Dispatch, and Slides it opens Settings from
the account menu, with ⌘, and with ⌘K › Settings, and follows three legacy
Settings links, each of which must land on its new page. The other journeys
projects carry the `[journey]` tests named after what users reported: signing in
and staying signed in (`[session]`), a credits or connect-AI state that
contradicts the account (`[credentials]`, `[settings-keys]`), a Slides PDF that
will not upload or import (`[slides-import]`), a form that cannot be published
and answered (`[forms]`), a design system stuck indexing (`[design-systems]`),
and a workspace app that 404s or changes lane when Dispatch opens it
(`[dispatch-apps]`).

The `chat-reliability` tests (`[chat-reliability]`) cover a run that does not
finish: a reload mid-run, a second message while one is running, Stop, a thread
that does not survive a reload, and an agent that claims a tool call it did not
make. `a second message during a run gets no error and both are answered` is
the regression guard for the 409 "Run already in progress" report; red with that
message is the finding, not a flake. The slides realtime test does not retry: its
idle window is 10 minutes.

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

Use a **dedicated e2e account whose email contains `+autoz`**, not a personal
one. The run writes to that account (see _What this run leaves behind_ below),
and CI artifacts contain traces of its authenticated requests, so its session
is effectively shared with anyone who can read this repository.

```bash
pnpm e2e:beta:capture
```

A browser opens per app. Sign in with the account this suite should run as —
prefer a dedicated e2e account over a personal one. The command prints the
values for `BETA_E2E_EMAIL` and `BETA_E2E_SESSION_TOKENS`. These are live
sessions for that account: treat them as credentials, and re-run the command
every 30 days when they expire.

**2. An OpenAI key.** Two options, and the run says out loud which one it used.

_Dedicated_ (default, recommended). Create a key with its own spend limit at
<https://platform.openai.com/api-keys> and add it as `BETA_E2E_OPENAI_API_KEY`.
Every turn then bills a credential nobody else uses, so this suite's cost is
separately visible and separately capped — the whole point of a second key.

_Shared_. The repository already has an `OPENAI_API_KEY`. Dispatch with
`key_source=shared` to bill it. That needs no new secret, but pools this
suite's spend with every other consumer of that key, so the attribution is
lost. It is never picked up implicitly: a run has to ask for it, and global
setup logs a warning when it does.

Either way the key is installed at **user** scope against the e2e account only.
It must not be a site-level `OPENAI_API_KEY` on a beta Netlify site — that
would bill every visitor's turns to it, and the repo's Netlify env guard
rejects it anyway. It must not be written at org scope either, which would
change the default for everyone in the org.

### Repository secrets

| Secret                        | Purpose                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `BETA_E2E_EMAIL`              | The dedicated `+autoz` identity every authenticated spec asserts it is running as                      |
| `BETA_E2E_SESSION_TOKENS`     | Per-app map from `e2e:beta:capture`, e.g. `{"slides": "…", "chat": "…"}`                               |
| `BETA_E2E_SESSION_TOKEN_CRM`  | Optional beta CRM override when its isolated database needs a fresh session                            |
| `BETA_E2E_SESSION_TOKEN_CHAT` | Optional beta Chat override when its isolated database needs a fresh session                           |
| `BETA_E2E_OPENAI_API_KEY`     | Dedicated, separately-limited key for agent turns. Omit only if you dispatch with `key_source=shared`. |
| `QA_SLACK_BOT_TOKEN`          | Slack bot token (`chat:write`) the scheduled reporter posts to `#qa-agent-native` with. See below.     |

The CRM and Chat overrides take precedence over their entries in the map, so
refreshing an isolated host does not require replacing the other live sessions.

## Reading a failure report

Every scheduled run ends in a `report` job that turns the run into three
things, using `scripts/beta-e2e-digest.ts` (Node only, no install step; its
tests are `scripts/beta-e2e-digest.test.ts`):

- **One GitHub issue**, `[beta-e2e] Scheduled beta health check failing`
  (labels `beta-e2e` and `qa`). Its body is rewritten in place on every run with
  the current state, so it is always the answer to "what is red now". A comment
  is added only when the set of failures changes, and a green run comments with
  the recovery, rewrites the body, and closes the issue.
- **A Slack message** in `#qa-agent-native`, at most twelve lines: counts, the
  top five failures, new versus persistent, and links to the run, the issue,
  the failed jobs, and the artifacts. It posts on green to red, when new
  failures appear, on recovery, and as a reminder at most once every 24 hours
  while still red. An identical red run stays quiet.
- **A hidden state marker** (an HTML comment in the issue body) that the next
  run reads, which is how NEW, STILL FAILING since run N, and FIXED are worked
  out, and how consecutive red runs and the last green run are counted.

Reading the issue, top to bottom: the status line gives the counts and the
transitions; **Failed jobs** links each failed job with the step it failed at;
**Failing tests** has one row per test with its class, app, lane and project,
`file:line`, title, first error line, and the screenshot and artifact to open;
**Jobs and setup without usable test results** is where a job that was killed or
failed before writing a report is stated as a fact, with the last `[beta-e2e]`
line it logged, which is how a hung host is named; **Not run this time**,
**Error details**, **Fixed**, and **Flaky** follow, and **How to investigate** ends with the exact
commands to download the artifact and to reproduce a test on CI
(`gh workflow run beta-e2e.yml --ref main -f apps=<app> -f lane=authed -f grep='<title>'`)
or locally
(`BETA_E2E_APPS=<app> pnpm e2e:beta --project=<project> --grep '<title>'`).

Each failure carries a class: `[product]` an assertion failed, `[env]` a
credential or session problem (an expired token, the wrong identity, a rejected
OpenAI key), and `[infra-timeout]` a timeout, cancellation, or network failure
before the product could be judged. Flaky tests (green on retry) are listed but
never fail the run or page anyone, and the advisory lane is reported without
gating. A failure from the last red run is **FIXED** only when that test
executed and passed in this run. One that did not run (its slot stopped at
`maxFailures` or the global timeout, produced no results, skipped it, or no
longer has that title) is **NOT RUN**: listed under "Not run this time", kept in
the state so it does not come back as NEW, and never counted fixed. NOT RUN
entries do not make a run red, page anyone, or trigger a comment on their own;
a slot that stopped early is red because of its own timeout or failure entries.
A green run closes any open issue, including one that predates the state marker,
and says how many tests it could not verify.

### Slack setup (one time)

The reporter uses the `QA_SLACK_BOT_TOKEN` repository secret with
`slackapi/slack-github-action` (`chat.postMessage`, channel `C0C4U4XRT6X`).

1. Add `QA_SLACK_BOT_TOKEN`, a bot token with `chat:write`, as a repository
   secret.
2. Run `/invite @<the bot>` in `#qa-agent-native` once. Without it Slack answers
   `not_in_channel`.

Until both are done nothing is posted, and that is said, not skipped: the report
job emits a `::warning::`, writes a line in its summary, and puts "Slack
notification not configured" in the issue body. A failed post (`not_in_channel`,
an invalid token) is reported the same way with Slack's error code, and never
stops the issue from being updated.

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

If `BETA_E2E_EMAIL` is not the dedicated `+autoz` identity, keep the run
failed. The existing recovery command for the fleet run is:

```bash
pnpm e2e:beta:capture
```

Replace the `BETA_E2E_EMAIL` and `BETA_E2E_SESSION_TOKENS` repository secrets
with the command's output, then rerun the authenticated lane. A targeted
`pnpm e2e:beta:capture design` refresh is valid only for a Design-only
dispatch; it must not replace the fleet token map used by scheduled runs. Do
not weaken the `+autoz` validation.

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
so asserting unconditionally would fail apps that legitimately offer password
and Supabase sign-in instead. The suite reads the rendered page
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

The specs create no lasting app fixtures. The Design lane creates one run-marked
temporary design and deletes it in `finally`; the Slides PDF import, forms,
Analytics dashboard, and chat tool-call tests each create run-marked data (a
deck, a published public form and its response, a SQL dashboard
`beta-e2e-cr-<nonce>`, a personal resource `e2e-cr-<nonce>.md`) and delete it in
`finally`, and a failed cleanup remains under the dedicated QA account. Two
things cannot be deleted by the suite: a ~1 KB PDF the composer upload test sends
to the account's file storage (no delete route exists), and the chat threads of
a failed `[chat-reliability]` test, which are kept on purpose so the thread id in
the failure message can be opened. An authenticated run is not read-only, and
most of what it writes lands in a production database:

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
the budget model stays luna, the promotion workflow stays manually invokable,
the matrices stay capped and every job and slot keeps a timeout with a smaller
Playwright `globalTimeout`, global setup stays bounded and keeps throwing, and
the scheduled wrapper keeps its six-hour issue lifecycle, pinned Slack action,
and minimal permissions. Its test is `scripts/guard-beta-e2e-suite.test.ts`.
