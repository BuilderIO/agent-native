---
name: plan-editions
description: >-
  Writing an edition of the engineering newspaper — the scheduled digest of
  merged-PR recaps — and the schedule that publishes it. Use when a user asks
  for a daily/weekly digest, a "what shipped" roundup, a catch-up on what
  happened while they were away, or when editing the edition actions.
---

# Plan Editions

An **edition** is one issue of the engineering newspaper: a stored `plans` row
with `kind: "edition"`, whose stories are written from the PR visual recaps the
app already holds. It lives at `/editions/:id`, and every story links back to
the recap it came from so a reader can drop into the real diff.

Editions ship behind the `plan.editions` lab. Every edition action answers 404
with "Editions is turned off in Labs" until the user turns it on under
Settings → Labs; say that rather than retrying.

Editions answer a question `search-pr-recaps` cannot: not "find me the recap for
X" but "tell me what happened, grouped into the handful of things that actually
matter". Several PRs that were one piece of work become one story.

## Writing an edition

Seven steps, in this order.

**1. Select candidates.** Call `list-edition-candidates` with the window. It
returns compact candidates (title, brief, repo, PR, recap URL). It deliberately
does **not** return recap bodies — a 40-recap day is far too large to read
whole. Read the `brief` of every candidate, pick the 5–8 that carry the day, and
only then call `get-visual-plan` on those to read their blocks in full.

**2. Pass a merged-PR ledger only if you already have one.** Plan exposes no
provider-api action, so there is no GitHub tool here to fetch one with: do not
go looking for a token. `mergedPrLedger` is optional, and its only job is the
coverage note — which merged PRs shipped with no recap. Omit it and the edition
publishes from the recaps alone, saying nothing it cannot prove. Supply it only
when the session already has GitHub access (a local `gh`, say) and the extra
round trip is worth a more complete colophon.

**3. Shape the issue: at most three lead stories.** This is the decision that
makes an edition readable. Every well-regarded product in this space runs one to
three narrative items and collapses the rest — Notion's `And a few more…`,
Railway's `Fixes and improvements`, Raycast's `New / Improvements / Fixes`,
Linear's tail sections, Google News' five-story briefing cap. Unequal treatment
*is* the hierarchy; seven co-equal stories read as a wall.

So: pick **three** stories that carry the day. Everything else becomes a
quick-link one-liner — `lead: false`, a single area tag, and a headline that is
one plain sentence. Aim for roughly one lead per three-to-five quick links.

**4. Write the headline as an abstract.** Techmeme rewrites every headline to be
"rich on specifics: headlines with names, numbers, and active verbs. Headlines
that function as abstracts." Put the shape of the story *in the sentence* — "Live
visual-edit becomes fully editable; eleven PRs make the chrome survive
hydration" — so a reader who reads nothing else still knows what happened. One
dek sentence after it, stating the consequence, not the implementation.

**5. Group the pull requests into cohorts, never one row per PR.** A story that
spans eleven PRs must not print eleven citations; no product in this space shows
per-PR metadata at all, and the ones that solved this group instead. CodeRabbit
collapses 28 changed files into two rows — a bold human-named cohort, then one
plain sentence. Do the same with PRs: pass 2-4 `cohorts`, each with a `name`, a
one-sentence `sentence`, its `prNumbers`, and its `repos`.

Set `mechanical: true` on a cohort that is release commits, lockfiles, codegen,
or translation churn. Those render dimmed and sorted last instead of competing
with real work — the same suppression `linguist-generated` gives a diff.

Do not try to put author names or per-PR diff stats in the prose. The reader
sees one aggregate per story and a capped avatar stack; per-PR numbers invite a
comparison that cannot be made correctly anyway, which is why LinearB shows one
aggregate per unit rather than one per PR.

**6. Cite the visuals.** A recap carries roughly nine blocks — diffs, diagrams,
file-trees, wireframes, annotated code — and prose alone throws all of it away.
For each lead story pick 1-4 block ids from the recaps you read and pass them as
`blockIds` on that recap ref. The **first** id is the story's lead art and
renders above the fold, so choose the one that makes the change legible at a
glance: the diagram for a flow change, the before/after diff for a behavior
change, the wireframe for a UI change, the file-tree for a wide refactor.

Cite a visual only when the change earns one — Greptile generates no diagram for
a trivial change, and a sequence diagram on a copy tweak costs the reader more
than it gives. Quick links carry no art at all; media presence is the tier
marker.

Blocks are referenced by id, never copied, so an edition can never show a
diagram the recap has since corrected. `get-edition` reports
`unresolvedBlockRefs` when an id no longer resolves.

**7. Publish.** Call `create-edition` **exactly once**, with every story in the
same call. Do not create an edition and then append stories: a background run
that is cut off and retried would replay the appends and leave a half-written
paper. The action is idempotent on the window's day key, so a retry replaces the
edition rather than publishing a second one, and it keeps the issue number it
was first published with.

## The two rules that matter

**An empty candidate set is not a quiet day.** Recaps are org-visible, and
`accessFilter` matches only the caller's *active* org, so a caller in the wrong
org sees zero recaps — identical to a day on which nothing merged.
`list-edition-candidates` throws when it can read no recaps at all, and returns
`status: "empty-window"` only when recaps exist but none fall in the window.
Never write an edition that says it was quiet because a query came back empty.

**"No recap" and "stale recap" are different gaps.** CI stamps merged-at only on
the merge-close run, so a skipped or failed one leaves a real, readable recap
frozen as `open`. Coverage therefore reports three states, and the edition must
keep them apart: `recapCount` (in-window, merge-proven), `stalePrs` (a recap
exists but was never re-published at merge), and `missingPrs` (no recap at all).
Reporting a stale recap as missing tells a reader to go read a diff by hand when
a recap is sitting right there — measured on real data, 1 of 9 uncovered PRs in
a single day was stale rather than missing.

**A missing number is not zero.** `filesChanged`, `additions`, and `deletions`
on a story's recap refs are `number | null`, where `null` means the stat could
not be resolved. Pass `null`, never `0`. Recap coverage also runs under 100% —
tiny diffs, fork PRs, and failed recap runs all skip silently — so the coverage
note states which merged PRs shipped without a recap instead of implying the
recaps were the whole day.

## Series: more than one recurring edition

An edition belongs to a **series** — `daily` by default, or any lowercase slug
such as `internal-daily`, `design-weekly`, `platform-weekly`. Identity is
`(owner, org, series, window)`, so a per-repo or per-team edition covering the
same day as the org-wide one is a separate issue rather than a replacement.
Issue numbers run per series, so `internal-daily` has its own No. 1.

Scope the *selection* to match the series: pass `repos` to
`list-edition-candidates`, scoped to the same repos. A series
whose window selection is not scoped will just reprint the org-wide edition
under a second name.

One automation per series, each naming its own scope:

```
manage-automations action=define name=plan-daily-edition
  schedule="0 7 * * *"  body="… series `daily`, all repos …"

manage-automations action=define name=plan-internal-weekly
  schedule="0 8 * * 1"  body="… series `internal-weekly`, repos
                              BuilderIO/builder-internal, over the last 7 days …"
```

Rows written before series existed read as `daily`, so an existing daily
edition keeps working and keeps its number.

## Scheduling it

The morning edition is a scheduled organization automation, not a job file:

```
manage-automations action=define
  name=plan-daily-edition
  trigger_type=schedule
  schedule="0 7 * * *"
  timezone=<the team's IANA zone>
  scope=organization
  mode=agentic
  domain=plan
  body="Publish today's edition of the engineering newspaper for the last 24
        hours, following the plan-editions skill."
```

**Align the window to the timezone's midnights, not to UTC's.** The day key is
derived from the window, so a UTC-day window read in `Europe/Amsterdam` spans
two local days and the edition names itself `2026-09-20_2026-09-21` instead of
`2026-09-20`. For a 07:00 Amsterdam run covering the previous local day, pass
`2026-09-19T22:00:00Z` to `2026-09-20T22:00:00Z`.

Set `timezone` explicitly — an absent timezone follows the deploy host, not UTC.
The automation runs with the org from its own stored identity, so it must be
created in the organization that owns the CI-published recaps, or selection will
throw. Test with `action=run-now`, which does real work without disturbing the
next scheduled run.

The scheduler does not backfill: a missed morning is gone. Catch-up is the same
actions over a wider window — `list-edition-candidates` and `create-edition`
both take an arbitrary `windowStart`/`windowEnd`, and the day key becomes a
range (`2026-09-08_2026-09-21`).

## The edition is also read aloud

The reader has a Listen control, and the script is built from the fields you
write — the headline, the dek, `whatShipped`, and each cohort's `sentence`.
Nothing else is spoken: not the diffs, the file lists, the pull-request numbers
or the stats, because reading those aloud is noise.

So write those four fields as sentences a person could say. A dek of
`grid drag: transactionId` reads fine on the page and reads as nothing at all
out loud; `Multi-selection now travels as one pending Apply unit` works in both.
A story whose prose is only identifiers is a story the listener skips.

## Actions

| Action | Purpose |
| --- | --- |
| `list-edition-candidates` | Select in-window merged-PR recaps; compute coverage |
| `get-visual-plan` | Read a chosen recap's blocks, to pick `blockIds` from |
| `create-edition` | Publish one edition and its stories in a single call |
| `get-edition` | Read an edition, its stories in order, and its coverage note |
| `list-editions` | The back-issue archive |

## Related Skills

- **plan-review-recaps** — the recaps an edition is written from.
- **plan-events** — `plan.created` fires for a new edition with `kind`.
- **plan-hosted-writes** — verify every hosted write by re-reading it.
