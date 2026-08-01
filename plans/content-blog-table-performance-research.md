# Why did the Content blog table feel unusably slow?

Date: 2026-07-28

## Answer

The 16:01 Clips recording separates four different kinds of delay that Rewind had blurred together:

- creating the replacement Blog database left a titled but empty surface on screen for **at least 25 seconds**, and the usable empty table only appeared after Alice navigated away and back;
- attaching the Builder source produced the first useful imported rows in roughly **5-10 seconds**, but truthful background source/body hydration continued for roughly **3 minutes 15 seconds**;
- sorting by Date replaced the populated table with `Loading database` for roughly **5-10 seconds**;
- opening Builder's review surface spent roughly **1 minute 40 seconds** on `Loading the complete Builder diff` before showing the review.

Opening an imported row was materially better but still staged: useful article content appeared in roughly **5 seconds**, with its property metadata settling roughly **10-15 seconds later**. Property-picker dwell was long, but the clip shows Alice browsing and choosing fields during much of it, so it is not valid to label the whole picker-open interval as application latency.

The current code makes those delays plausible. Opening a database is a composed read with more than a dozen visible SQL phases. Even though the UI initially asks for only 100 rows, it still loads complete attached-source snapshots and filters them to the visible page afterward. Several mutations also return a complete, sometimes unpaginated database snapshot and then invalidate queries that read the database again. Search, filter, sort, grouping, calendar, and timeline modes may expand the request from 100 rows to as many as 5,000, which the table renders without row virtualization.

The implementation shape is now frozen. Work should first capture exact browser and server spans for the representative workflow, then deliver four bounded changes: a page-bounded table/source projection, server-bounded table constraints, delta-shaped mutations with exact cache updates, and progressive Builder review/body hydration. Each slice must be accepted against the same visual boundaries and approved budgets without weakening source-review correctness, sharing, cross-tab sync, or Yjs row-body behavior.

## Rewind Evidence

### Coverage and limits

- Screen Memory was enabled and not paused, but status reported `segmentCount: 0`.
- The chapter search returned no matching current chapter and carried a stale `generatedAt` value from 2026-07-21.
- A 32-minute local OCR search covered 10:33:25-10:52:04 EDT and reported 66 Blog-matching observations; its broad result returned the newest 50 and omitted 16. Targeted searches recovered the important earlier transitions.
- Four five-minute contact-sheet requests covering 10:34-10:54 and an exact-frame request at 10:50:44 all failed with `No clean retained Rewind frames`.
- Therefore the observations below are OCR screen-state samples, normally ten seconds apart. They measure visible-state dwell, not exact click-to-response latency. Deliberate user pauses cannot be distinguished from an unresponsive UI unless a start and completion state are both visible.

### Observed timeline

| Local time        | Visible state                                       | Measurement                                                                                        | Confidence                |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| 10:37:05          | Blog table with `Sort Descending` visible           | Operation boundary unknown                                                                         | Low                       |
| 10:37:15          | Blog table with `Duplicate property` visible        | Picker/menu changed within about 10 seconds                                                        | Medium                    |
| 10:37:25          | Only `Blog (ALPHA TESTING)` remained visible        | Later coverage gap prevents a latency claim                                                        | Low                       |
| 10:42:44-10:43:14 | `Questions to Ask Beth...` visible under Blog       | State persisted for at least 30 seconds; no click boundary                                         | Low                       |
| 10:43:24-10:43:34 | `Agent-Native Plan` title/shell only                | Body not yet visible                                                                               | Medium                    |
| 10:43:44          | Agent-Native Plan body visible                      | About 20 seconds title-to-body                                                                     | Medium; not click-to-body |
| 10:43:44-10:44:04 | Delete-page, then delete-database UI, then body     | Each visible transition happened within one 10-second sample                                       | Medium                    |
| 10:44:14          | `Blog` shell/title only                             | Start of clearest table-load interval                                                              | High                      |
| 10:44:24-10:44:34 | Blog table frame/title, no useful rows detected     | Still waiting                                                                                      | High                      |
| 10:44:54          | First useful row detected                           | Roughly 30-40 seconds shell-to-first-row                                                           | Medium-high               |
| 10:45:04          | `100 changes / ready` and one row detected          | Intermediate state                                                                                 | Medium                    |
| 10:45:34          | Multiple rows detected                              | Roughly 50-80 seconds shell-to-populated-table because 10:45:14/24 samples did not match the query | Medium                    |
| 10:45:34-10:47:44 | Same populated table state                          | Stable view; not operation latency                                                                 | High                      |
| 10:49:14-10:49:44 | Property search/picker visible                      | 30-second dwell; user choice versus UI delay unknown                                               | Low                       |
| 10:49:54          | Picker closed and table visible                     | Completion occurred within the next sample                                                         | Medium                    |
| 10:50:24-10:51:04 | Property picker visible again with changing choices | At least 40 seconds of interaction; latency cannot be isolated                                     | Low                       |
| 10:51:14          | KPMG row body visible                               | Start click unknown                                                                                | Low                       |
| 10:51:24          | Back at table                                       | Visible round trip completed within about 10 seconds                                               | Medium                    |
| 10:51:34-10:52:04 | Property picker visible                             | At least 30 seconds; no completion captured                                                        | Low                       |

## Clips Evidence

### Coverage and method

- Public recording: `https://clips.agent-native.com/share/BfEnyRiC4Pu7?ref=clip_share`.
- Recording duration: 16:00.905, 1280x830, captured in Safari on 2026-07-28.
- The Clips transcript was still `pending`, so timings come from the video clock and visible UI states.
- The full recording was sampled every five seconds, then the operation boundaries below were checked against the neighboring frames. Durations are therefore reported as ranges, normally with a +/- 2.5-second boundary tolerance, rather than invented millisecond precision.
- `First useful` means Alice can see or act on real rows/content. `Settled` means the visible loading/sync state for that operation has completed. A persistent background sync is reported separately rather than pretending the earlier usable state was still blank.

### Measured operation ledger

| Clip time   | User operation                                                       | First useful / completion                                                                    | Measured wait                        | What was visibly happening                                                     | Confidence                                             |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 00:17-00:22 | Permanently delete the old `Blog (ALPHA TESTING)` database           | Dialog disappears and deletion toast appears                                                 | <=5s                                 | Destructive mutation                                                           | Medium-high                                            |
| 00:27-00:42 | Create a new page/database and name it `Blog (ALPHA TEST)`           | Titled database shell appears                                                                | ~15s to shell                        | Page/database creation                                                         | Medium                                                 |
| 00:42-01:07 | Wait on the new database shell                                       | No usable table appears before Alice leaves for Notion                                       | >=25s unresolved                     | Empty/titled surface with no table controls or rows                            | High for visible dwell; root cause unknown             |
| 01:42-02:06 | Return to Content, navigate away from the stuck Blog page, then back | Empty Blog table with Name and Content columns appears                                       | ~24s end-to-end; includes navigation | Recovery/navigation plus database read                                         | Medium; not a single request                           |
| 02:32-02:52 | Find the Builder Blog model and choose Attach                        | Attach command issued                                                                        | ~20s user interaction                | Search/browse/selection, not system latency                                    | High; exclude from performance budget                  |
| 02:52-03:01 | Attach Builder source                                                | First imported rows and source-progress UI appear                                            | ~5-10s to useful rows                | Source attach and initial projection                                           | Medium-high                                            |
| 03:01-06:17 | Let attached source finish fetching/hydrating                        | Progress advances from 24/100 through 584 rows and body sync; normal table remains available | ~3m15s to settled                    | Background row fetch/body hydration                                            | High; table was usable during most of it               |
| 06:37-06:42 | Open `You Optimized the Wrong 0.6%`                                  | Article title/body visible in side panel                                                     | ~5s to useful body                   | Imported-row/document read                                                     | Medium-high                                            |
| 06:52-07:16 | Add/reveal Author property                                           | Author column appears populated                                                              | ~24s total picker-to-column          | Mostly property browsing plus a final mutation/read                            | Low as latency; exact choice click needs request trace |
| 07:37-07:57 | Add/reveal Date property                                             | Date column appears populated                                                                | ~20s total picker-to-column          | Mostly property browsing plus a final mutation/read                            | Low as latency; exact choice click needs request trace |
| 08:07-08:16 | Sort Date descending                                                 | Sorted populated table returns                                                               | ~5-10s                               | Whole table replaced by `Loading database`                                     | High                                                   |
| 08:22-08:27 | Reorder Date and Author columns                                      | New column order visible                                                                     | <=5s                                 | Local/view configuration                                                       | Medium-high                                            |
| 08:52-09:02 | Rename database to `Blog Test`                                       | New title stable                                                                             | ~5-10s including typing              | Title mutation                                                                 | Medium                                                 |
| 09:47-09:57 | Open `The Future of SaaS Is Cloneable`                               | Useful article body visible                                                                  | ~5-10s                               | Row/document read                                                              | Medium-high                                            |
| 09:57-10:12 | Wait for row metadata to settle                                      | Kind, Parent, and Source fields become visible                                               | ~10-15s after body                   | Property/metadata read after useful content                                    | Medium-high                                            |
| 10:52-10:57 | Open database settings                                               | Settings panel visible                                                                       | <=5s                                 | Local settings surface                                                         | Medium-high                                            |
| 11:37-13:17 | Open Review Builder update                                           | Complete diff finally appears                                                                | ~1m40s                               | Modal remains on `Loading the complete Builder diff` / `Preparing full review` | High                                                   |
| 14:42-14:52 | Prepare/review one selected Builder update                           | Validation error becomes visible                                                             | ~5-10s                               | `Preparing` ends in typed author-model validation failure                      | Medium-high                                            |
| 15:27-15:32 | Close the review modal                                               | Table visible again                                                                          | <=5s                                 | Local modal close                                                              | High                                                   |

### Longest confirmed waits

1. Attached-source fetch/body hydration: approximately **3m15s** to settle, although useful rows appeared after 5-10 seconds.
2. Complete Builder review diff: approximately **1m40s** before review content appeared.
3. New database shell with no usable table: **at least 25s**, unresolved until Alice navigated away.
4. Return/recovery to the empty table: approximately **24s**, including Alice's navigation rather than one isolated request.
5. Date sort: approximately **5-10s** with a blocking whole-table loading state.

The clip therefore disproves a single "table takes a minute to load" story. The worst elapsed operation is background hydration; the worst blocking routine table operation captured is sort; and the longest blocking source-review operation is diff preparation.

## Current-Code Evidence

### Database open carries too much serial work

- The editor deliberately requires an authoritative `get-document` read; a seeded database snapshot does not satisfy it (`templates/content/app/hooks/use-documents.ts`, `templates/content/app/components/editor/DocumentEditor.tsx`).
- The database page mounts another document read and independently starts `get-content-database`, personal-view, and content-space reads (`templates/content/app/components/editor/DocumentDatabase.tsx`, `templates/content/app/components/editor/database/DatabaseView.tsx`).
- `get-content-database` resolves the database, checks access, builds the composed response, reloads the backing document, and computes context (`templates/content/actions/get-content-database.ts`).
- `getContentDatabaseResponse` serially reads the database, backing document, count, items, documents, favorites, shares, row properties, schema properties, hydration queue, attached sources, federation, and context (`templates/content/actions/_database-utils.ts`).
- Property values are batched, but batch chunks and rollups can still run serially. Rollups can grow with rows times rollup properties (`templates/content/actions/_property-utils.ts`).

### Pagination does not bound attached-source work

- The UI initially requests 100 rows (`DatabaseView.tsx`).
- Every attached source snapshot is nevertheless loaded serially (`templates/content/actions/_database-source-utils.ts`).
- Each snapshot reads complete source rows and can repeat a consistency sequence of marker -> rows -> marker up to three times.
- Only after complete source snapshots exist does `getContentDatabaseResponse` filter their rows to the visible page (`_database-utils.ts`).
- This is the strongest code-backed explanation for a Builder-backed Blog table taking tens of seconds while an ordinary page is much lighter. It remains an inference until exact server spans identify the dominant phase.

### Several writes perform avoidable full reads

- `create-content-database` and `add-database-item` return a complete database response after the write (`templates/content/actions/create-content-database.ts`, `add-database-item.ts`).
- Add, move, duplicate, bulk delete, and bulk duplicate omit the page limit when rebuilding the response, so the returned snapshot can be unpaginated.
- Successful mutations broadly invalidate active action queries unless a hook opts out. Several database hooks then issue their own targeted invalidations (`packages/core/src/client/use-action.ts`, `templates/content/app/hooks/use-content-database.ts`).
- The result can be: perform write -> rebuild full snapshot -> return it -> invalidate -> fetch again.
- Property configuration is narrower, but it still reconstructs row properties and then invalidates properties, document, and database reads (`templates/content/actions/configure-document-property.ts`, `templates/content/app/hooks/use-document-properties.ts`).

### Large constrained views move the problem into the browser too

- Search, filter, sort, grouping, calendar, and timeline constraints can expand from the initial 100 rows to the complete dataset, capped at 5,000 (`DatabaseView.tsx`).
- Table rows are rendered with an unvirtualized `items.map`.
- This can combine a larger server response, more source/federation work, more transferred bytes, and a large React commit.

### Existing protections that should not be blamed or removed

- Ordinary client navigation no longer revalidates the root locale loader (`templates/content/app/root.tsx`); prior independent slow-network QA measured a 65.3 ms route commit under an artificial eight-second delay. Route commitment is not the same as useful table content.
- Core `useDbSync` ignores the current tab's own action echo, coalesces invalidations, does not cancel and restart matching reads already in flight, and suppresses broad invalidation for source refresh/body hydration events (`packages/core/src/client/use-db-sync.ts`, `templates/content/app/hooks/use-db-sync.ts`).
- Property values and several document metadata edits already use optimistic cache patches with rollback. Preserve that direction.

## Existing Observability

The Core action client already emits `action.response` for every action taking at least one second and for a sample of faster successes. The event includes action name, request ID, total duration, time to first byte, body-read duration, server duration, network overhead, framework startup wait, database wall time/connect time/slowest operation, response bytes, outcome, and status (`packages/core/src/client/use-action.ts`).

This is useful but not sufficient. It does not identify which phase inside `get-content-database` consumed the server time, how many SQL round trips ran, how many source rows/change sets were scanned, how many duplicate client requests followed one gesture, or when the interface first became useful.

## Inferences

Ranked hypotheses to test:

1. **Complete source snapshots are blocking basic table reads.** This best matches a Builder-backed Blog table and the 30-80 second observed load.
2. **Writes rebuild an unbounded snapshot and then cause another read.** This best explains why ordinary row/property operations can feel as slow as opening the table.
3. **A constrained view expands to thousands of rows and renders them all.** This would amplify both server and browser cost after sort/filter/search/group changes.
4. **Authoritative row reads and Builder/Yjs hydration delay useful/editable row content.** This matches the observed title-before-body interval.
5. **Rollup evaluation can produce row-by-property query growth.** Relevant only if this Blog schema uses rollups; not established from Rewind.

## Uncertainties

- Clip boundaries are accurate to roughly one five-second sampling interval, not milliseconds; matching request IDs are still needed for exact action latency.
- The video distinguishes picker deliberation from blocking states, but the exact property-choice click falls between sampled frames.
- No matching production analytics query capability is available in this task, so the existing `action.response` events for Alice's exact session were not retrieved.
- The clip proves one attached Builder source and a 584-row imported table. Payload sizes, rollups, database latency, source-snapshot retry count, and React commit duration remain unmeasured.
- It is not yet known which server phase dominated the stuck new-database shell, Date sort, complete-diff preparation, or the delayed row metadata.

## Architecture Constraints

### Demonstrated caller and request

- Alice, using the production Agent Native Content interface, opened and edited the Builder-backed `Blog (ALPHA TESTING)` database and experienced routine operations as unusably slow.
- The required workflow is ordinary table use: open the database, reveal/add a property, edit a value, open a row, and return.

### Existing primitives and ownership boundaries

- UI operations already use Content actions and React Query hooks; they should continue to do so.
- Core owns action transport, Server-Timing parsing, `action.response` telemetry, request-source identity, and database-sync invalidation behavior.
- Content owns database read composition, source snapshot serialization, pagination, source review state, optimistic cache updates, and row/document hydration.
- Builder is a source provider. Basic table visibility should consume persisted SQL projections; live provider work must not become an implicit prerequisite for every interaction.

### Legacy contracts that must remain unchanged

- Access checks and ownable-data scoping.
- Multi-source federation and exact source-review/change-set semantics.
- Agent/script/other-tab changes still refresh the current UI.
- Current-tab optimistic edits roll back on failure.
- Open documents still use an authoritative body path and preserve Yjs collaboration.
- Initial table pagination, source status, body hydration status, and review counts remain truthful rather than being replaced by plausible empty values.

### Smallest compatible delta

Do not begin with a broad cache rewrite. First capture one exact representative trace and split `get-content-database` into named timing phases. Then make the basic 100-row table projection independent of complete source-review snapshots, returning only page-bounded source overlay/status data needed to render those rows. Load full review/change-set/audit state only for the review surface that consumes it. In parallel, replace full post-write snapshots with bounded deltas or page-bounded responses and remove invalidations made redundant by an exact optimistic patch.

### Deferred capabilities

- A general query planner for every Content database shape.
- Infinite scrolling or a redesigned pagination model.
- A complete rollup engine rewrite.
- A new sync transport.
- Provider live reads during ordinary table render.

### Direct evidence versus inference

- Direct: OCR state timestamps, frame-retention failures, current action/hook/read paths, existing telemetry fields, current 100/5,000 limits, serial source-snapshot loading, post-read page filtering, full-snapshot mutation responses, broad-plus-targeted invalidations, unvirtualized row rendering.
- Inference: which phase dominated Alice's exact session and the relative contribution of cold start, database network latency, source snapshots, client refetches, and React rendering.

## Recommendation

### First Work slice: exact trace and critical-path separation

1. Reproduce the now-defined blocking cases separately: create/open the new database, sort Date, open an imported row, and open the complete Builder review diff. The supplied 16-minute clip is the UX baseline; no replacement clip is required.
2. Capture each reproduction's browser network waterfall and Core `action.response` request IDs.
3. Add server spans inside `get-content-database` for access, count/items, documents, properties/rollups, per-source snapshots and consistency retries, federation, context, and serialization. Attach query count, sequential critical-path round trips, rows scanned/returned, source/change-set/execution counts, response bytes, and cold-start/connect timing.
4. Record browser marks for intent -> route/shell -> first useful rows -> settled table, plus intent -> optimistic paint -> action acknowledgement -> cache settled.
5. Compare an unsourced table with the same row count against the Blog Builder source, then 0/100/1,000 rows, no rollups versus rollups, and unconstrained versus filtered/sorted/grouped views.

### Likely second Work slice, if the trace confirms hypothesis 1

- Keep the initial 100-row database projection page-bounded end to end.
- Read only the source rows/overlays needed for visible documents.
- Return lightweight source status/counts with the table; fetch full change sets, reviews, executions, and consistency material when the review surface opens.
- Preserve a typed unavailable/error state; never turn a failed source snapshot into an empty successful table.

### Likely third Work slice, if the trace confirms hypothesis 2 or 3

- Make row/property mutations optimistically useful immediately and return bounded deltas instead of complete unpaginated snapshots.
- Suppress default broad invalidation where the hook performs an exact targeted update; keep other-tab and agent refresh semantics.
- Keep constrained reads server-side and paginated rather than expanding silently to 5,000 client-rendered rows; virtualize only if a legitimately large client result remains part of the accepted product contract.

## Proposed Acceptance Story

On the production-like Builder-backed Blog fixture, Alice can open the table, reveal/add a property, edit one value, open a row, and return without losing context or waiting through a blank/stale interface.

Required assertions:

- Route/shell responds to every gesture within 100 ms.
- Warm table open shows first useful rows within 1 second; cold open within 2 seconds, excluding an explicitly measured and separately reported platform cold start.
- Property picker opens locally within 100 ms.
- Property/value changes paint optimistically within 100 ms, acknowledge within 1 second warm / 2 seconds cold, roll back visibly on failure, and do not blank the table.
- Row shell opens within 100 ms; authoritative body appears within 1 second warm / 2 seconds cold; editability reports Yjs or Builder hydration separately instead of holding the entire page in an undifferentiated wait.
- One gesture produces a bounded, asserted action/request count with no full unpaginated snapshot or redundant table refetch.
- Initial table read work is proportional to the requested page and attached sources needed for that page, not the complete provider corpus or review history.
- 100-, 1,000-, and 5,000-row fixtures meet explicit server, payload, and React-commit budgets; constrained views do not silently force an unvirtualized 5,000-row client render.
- Sharing, multi-source federation, source-review truth, other-tab/agent refresh, optimistic rollback, Yjs collaboration, and typed failure states remain correct.

### Approved operation budgets

Alice approved these values on 2026-07-29 as the acceptance target for this lane:

| Operation                         | Accepted target                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Delete database                   | Immediate removal; server acknowledgement within 1 second                                                   |
| Create and name database          | Shell within 100 ms; usable empty table within 1 second warm / 2 seconds cold                               |
| Recover or return to table        | Route shell within 100 ms; useful table within 1 second warm / 2 seconds cold                               |
| Open Builder model picker         | Picker within 100 ms; search results within 300 ms                                                          |
| Attach Builder source             | Feedback within 100 ms; first useful rows within 2 seconds                                                  |
| Hydrate a 584-row attached source | Never block table interaction; metadata within 10 seconds and bodies within 30-60 seconds in the background |
| Open imported row                 | Shell within 100 ms; useful body within 1 second warm / 2 seconds cold                                      |
| Reveal/add a property             | Picker within 100 ms; selected column paints within 100 ms; acknowledgement within 1 second                 |
| Sort table                        | Existing rows remain visible; sorted result within 500 ms warm / 1 second cold                              |
| Reorder columns                   | Within 100 ms                                                                                               |
| Rename database                   | Optimistic title within 100 ms; acknowledgement within 1 second                                             |
| Load row metadata                 | Within 1 second warm / 2 seconds cold, without delaying the body                                            |
| Open database settings            | Within 100 ms                                                                                               |
| Open Builder review               | Shell within 100 ms; first changes within 2 seconds; full diff within 10 seconds or progressively loaded    |
| Prepare selected Builder update   | Success or typed validation error within 2 seconds                                                          |
| Close review surface              | Within 100 ms                                                                                               |

## Hosted acceptance ledger — 2026-07-30

The Builder connection was restored and the production-like 584-row source was
tested on PR #2522's exact Netlify deploy previews. The writable fixture was a
task-owned Content database; the Builder model remained read-only.

### Runtime improvements verified

- Before the source-field projection fix, revealing Author took **15.49s**.
  The bounded SQL projection reduced that to **969ms**; the later single-scan
  path produced three hosted acknowledgements of **1,087ms**, **977ms**, and
  **745ms** (median **977ms**) while the column painted optimistically in
  **34.2ms** and the existing 100 rows never disappeared.
- Sort retained the existing rows immediately. The hosted background request
  was **1.49-1.59s** cold, so visual continuity passes while the cold
  acknowledgement remains above the 1s target.
- Opening the Builder review showed progressive changes within **465ms**. The
  complete review request remained slow at **29.97s** (`app=26.14s`,
  `db=3.81s`), so progressive acceptance passes but eager full completion does
  not.
- Prefetching Builder models when Sources opens reduced the measured
  space-to-model paint from **1,263ms** to **43ms**.

### Fresh 584-row attach measurements

Exact deploy `6a6b7e943e99e3000899a44a` at commit `83c45829f`:

- feedback: **93ms**;
- first 100 useful rows: **5.56s**;
- attach request: **5.40s** (`app=5.20s`, `db=2.46s`);
- one complete continuation replaced five client-driven page continuations,
  but still took **22.61s** (`app=22.35s`, `db=11.15s`);
- complete metadata was therefore about **28.1s**, improved from the earlier
  run that was still at 300 rows after **59.5s** and only known complete by
  **182s**.

Exact deploy `6a6b8100dac828000830b1de` at commit `46ffed6a3` reused the
persisted row cursor and field schema:

- feedback: **78ms**;
- first 100 useful rows: **6.18s**;
- attach request: **5.94s** (`app=5.64s`, `db=2.97s`);
- remaining-row continuation: **20.30s** (`app=20.07s`, `db=10.29s`);
- complete metadata: **29.38s** from pointer intent.

The model-picker and immediate-feedback budgets now pass. First useful rows,
complete metadata, and background bodies do not: the prior completed run
reached 584 metadata rows between **59.5s and 182s**, then reported 582/584
usable bodies ready by **280.5s**. The single-continuation implementation makes
metadata substantially faster, but the accepted **2s / 10s / 30-60s** attach
ladder is not yet met.

### Verification and cleanup

- Focused UI tests: **64 passed**.
- Focused Builder resync tests: **4 passed**, including explicit full refresh,
  continuation convergence, a 597-row snapshot, and typed model-field failure.
- Content typecheck passed (with the existing Node 22.21/react-router version
  warning).
- PR fast lanes, Content DB tests, typecheck, build, security, and parity were
  green at `e717fdb3b`; the unrelated standalone Chat template E2E was red.
- All five task-owned hosted pages/databases were moved to Trash and permanently
  deleted. The final Personal and Trash snapshots contained no
  `__an_content_perf_2522_` marker. No Builder provider rows were written or
  deleted.

### Land decision

Do not merge yet. The remaining ingestion work needs a separate bounded slice:
parallelize the Builder list-page reads, reduce hosted SQL round trips while
importing the remaining 484 rows, and bulk/lazily schedule body conversion
without making metadata acknowledgement await the full hydration queue.

## Shaped implementation plan for the four remaining failures

Shaped on 2026-07-30 after hosted acceptance at `46ffed6a3`. This section is
the governing repair plan for PR #2522. It does not change the approved
operation budgets or permit a code-ready-only merge.

### Refresher and current truth

Routine interaction is no longer the large-table problem: Builder model
results paint in 43ms, attach feedback in 78-93ms, source columns in 34.2ms,
and progressive review in 465ms. Four assertions still fail:

| Boundary                               |                            Current | Required |
| -------------------------------------- | ---------------------------------: | -------: |
| First useful Builder rows after Attach |                              6.18s |     <=2s |
| Complete metadata for 584 rows         |                             29.38s |    <=10s |
| Usable bodies for the 584-row source   | <=280.5s in the last completed run |   30-60s |
| Cold Date-sort acknowledgement         |                         1.49-1.59s |     <=1s |

The first three failures share one ingestion path. The initial attach waits on
provider discovery, a projected first page, SQL import, source-row seeding, and
hydration-queue creation. The continuation then reads Builder pages serially
and repeats database setup reads before scheduling bodies. Body hydration
claims 25 jobs at a time but persists each converted row through its own
multi-statement transaction. Sort is separate: it retains rows visually, but a
constraint change still recomposes database/schema/source/context data when it
only needs a newly ordered item page.

### Frozen implementation boundary

- **Outcome:** every approved operation budget passes on the read-only
  `Agent Native Blog Article Test` model with more than 500 rows.
- **Shipping surface:** `BuilderIO/agent-native`, Content database UI and
  actions, for any Content user attaching and operating a large provider-backed
  database; durable destination is the existing PR #2522 merged to `main`.
- **Governing architecture:** actions remain the only data-operation surface;
  SQL remains authoritative; provider reads are projected and bounded; useful
  UI is optimistic/progressive; unfinished body work remains durable and typed.
- **Acceptance story:** Alice attaches the 584-row Builder model, sees real
  rows within 2s, receives complete metadata within 10s and bodies within 60s,
  then sorts within 1s without blanking or losing the table.
- **Risk strategy:** system-ready. No feature flag and no merge until all four
  assertions and the already-passing interaction assertions pass on the exact
  PR head.

Architecture grounding is required because the repair touches the shared
Content action contract, provider pagination, SQL import transactions, and the
durable hydration queue. Existing primitives to preserve are
`defineAction`, `useActionQuery`/`useActionMutation`, the Builder read client,
stable Builder import identities, refresh claims/cursors, the hydration queue,
targeted cache invalidation, and the current row-body conflict/CAS rules. No
custom REST route, provider write, direct UI fetch, new scheduler, large SQL
blob, or client-trusted provider snapshot belongs in this repair.

### Slice 1 — make sort a page read, not a database re-open

Add a page-shaped action, `query-content-database-items`, that reuses the
existing access filter, server-side constraint evaluator, item serializer, and
page-bounded source overlay but returns only:

- the ordered/filtered 100-row item page;
- pagination/count and `tableQueryMode`;
- property values and source overlays needed by those rows.

It must not reload database metadata, schema properties, full source status,
context path, review state, or hydration state unrelated to the returned page.
`DatabaseView` keeps the last good page visible with placeholder data and swaps
only the page cache when a sort changes. Other-tab/agent invalidation must still
refresh this action key.

Instrumentation for this slice separates constraint planning, item IDs,
documents, property values, overlay, and serialization, aligned to
pointer-to-paint and request acknowledgement. Remove or gate temporary phase
logging before completion.

Acceptance:

- existing rows never disappear;
- sorted paint and acknowledgement are <=500ms warm / <=1s cold across five
  hosted samples;
- exactly one page action follows one sort gesture;
- the response contains at most 100 rows and no document bodies/full source
  snapshots;
- access, filters, multi-sort, null ordering, pagination, federation, and
  other-tab refresh tests remain green.

Stop and reshape if the existing server constraint evaluator cannot produce a
page without first materializing all documents/properties in application
memory; that would require a broader SQL query-planner decision.

### Slice 2 — show truthful rows before attachment persistence settles

Add a read-only `preview-content-database-source-attach` action and query it
when the user opens a Builder model leaf. It returns the same projected first
100 provider rows the attach path consumes, without bodies or writes. On
Attach, the hook paints those real provider rows immediately in a typed
`attaching` state. They can be opened as read-only previews but are not
represented as persisted/editable until the attach action succeeds. Failure
rolls the preview back and leaves the original database intact.

In parallel, make the server attach read model fields and the first projected
content page concurrently, then batch the minimal document/item/source-identity
writes. The server must independently read and validate Builder data; it must
not trust provider rows echoed back by the browser. The successful response
reconciles the optimistic preview to stable document/item IDs without reflow.

Acceptance:

- feedback remains <=100ms;
- real first rows paint <=2s even when Attach is clicked before prefetch
  completes;
- rows are visibly typed as attaching/read-only until persistence succeeds;
- success preserves selection/order and failure removes only the preview;
- no provider body or credential enters the client cache or SQL list rows;
- attach idempotency, duplicate-title identity, access, and rollback tests pass.

Stop and reshape if a useful row must be editable before stable SQL identity
exists. The approved plan treats early rows as truthful read-only provider
previews, not fictional local rows.

### Slice 3 — finish all metadata in one bounded provider/SQL pass

Keep the current persisted continuation cursor, then change the complete read
to a bounded parallel window:

- fetch offsets 100-500 with at most four concurrent Builder requests;
- preserve offset order and stable-ID deduplication;
- stop at the first short page;
- retry transient page failures through the existing retry policy;
- report a typed incomplete/error result if any required page fails rather
  than treating a hole as completion.

On the SQL side, make `importBuilderCmsEntriesAsDatabaseItems` return the
minimal serialized imported rows it just created. Use that result to avoid the
second `sourceSetupPayload` and full existing-row reread. In one bounded
transaction, bulk-write documents, memberships, database items, source rows,
materialized values for already-bound properties, the compact hydration queue
identity/version envelope, and final source progress. Do not reseed unchanged
source fields. Body conversion is explicitly outside the metadata
acknowledgement; only durable queue creation belongs inside it.

Temporary spans must separately report provider-page wall time, import SQL
round trips, source-row/value writes, queue insertion, and final metadata
publication. The intended hosted budget allocation is <=3s provider,
<=5s SQL, and <=2s framework/network margin.

Acceptance:

- 584 metadata rows are complete <=10s from Attach across five hosted runs;
- the initial 100 rows remain visible throughout;
- the final active-source identity set is exactly 584 and stale rows prune only
  after complete coverage;
- 584/597/1,000-row deterministic fixtures prove ordering, cursor completion,
  duplicate IDs, short final pages, retries, suspicious-empty preservation,
  concurrent refresh claims, and provider failure;
- SQL/query-count assertions prove no second full setup read and no per-row
  write loop.

Stop and reduce provider concurrency if Builder returns 429s or the existing
retry envelope cannot bound the window safely. Do not trade correctness for an
optimistic completed count.

### Slice 4 — bulk body conversion without per-row database chatter

Retain the durable hydration queue and open-row priority, but refactor one pump
into three explicit phases:

1. claim and preload a bounded batch in bulk;
2. convert bodies with measured bounded concurrency;
3. persist successful, unavailable, superseded, and failed results with
   chunked CASE/CAS updates rather than one multi-query transaction per row.

The compare-and-swap protections remain mandatory: a local/Yjs edit, a newer
queue payload, or a changed source baseline must win over stale hydration. Use
portable Drizzle/shared SQL helpers and reviewed `getDbExec().execute()` only if
the shared query builder cannot express the chunked CAS. Queue payloads remain
compact identity/version/source references; raw bodies, screenshots, or large
Builder entries do not move into SQL.

Start with 50 jobs per pump and conversion concurrency 8, then tune from hosted
phase spans rather than raising both blindly. The client immediately requests
the next batch from the returned queue count without interleaving a complete
database/source refetch. Existing `useDbSync` suppression and targeted
invalidation remain in force. Two genuinely bodyless rows may end in typed
`unavailable`; they count as settled, not hydrated.

Acceptance:

- the table remains interactive for the entire run;
- 582 hydrated plus two typed unavailable rows settle <=60s in five hosted
  runs, with first-open row priority still <=2s;
- queue depth is monotonic except for explicit newer-version replacement;
- closing/reopening the page resumes durable work without duplication;
- supersession, local-edit conflict, retry cap, empty-body, bodyless-row,
  source-change, and partial-batch failure tests pass;
- query-count evidence shows O(chunks) writes, not O(rows) transactions.

Stop and reshape toward the existing framework job substrate only if the
durable client-driven pump cannot meet 60s while the table remains open. A new
background scheduler is deliberately deferred from the first repair.

### Cross-slice verification and Land gate

Use one deterministic local 584-row fixture for regression speed and one
task-owned hosted Content database attached read-only to
`Agent Native Blog Article Test`. Every hosted run records visual marks,
action request IDs, Server-Timing phases, request counts, row/body counts, and
cleanup proof. Instrumentation must align each server request with the visible
state transition it caused.

Before Land, rerun all previously passing budgets as non-regression gates:
43ms model results, <=100ms attach feedback, <=100ms source-column paint,
<=1s median property acknowledgement with no >2s cold sample, progressive
review <=2s, row shell/body targets, and no table blanking. Run Content DB,
source/resync/hydration, hook/cache, parity, typecheck, format, build, security,
and independent H1-H5 browser QA against the exact PR head. Permanently delete
every task-owned hosted fixture and independently prove its marker absent.

Land remains blocked until all four numbers and every preserved assertion pass.
The next authorized stage, after Alice approves this shaped plan, is `/work`
against this section of the existing brief.

The acceptance run must measure visible intent-to-paint and action completion separately. Background completion cannot be reported as blocking latency, and an optimistic paint cannot be reported as success before acknowledgement or rollback is observed.

## Local Performance Environment

### Current preflight, 2026-07-29

The repository contains the intended local database-mode path, but this worktree is not currently test-ready:

- repo root pins `pnpm@10.29.1`;
- `templates/content/package.json` still routes `dev:database` through `scripts/check-native-deps.mjs` and `scripts/dev-database.mjs`;
- Node is v22.21.1, ABI 127, arm64;
- repository `node_modules` is absent;
- `templates/content/.env.local` and repo-root `.env` are absent;
- no Content dev server is running;
- the native preflight fails loudly with `better-sqlite3 is not installed`.

The canonical checkout at `/Users/alicemoore/Developer/agent-native` does have repository dependencies plus both relevant env files. Their values were not read or printed. Work can use that existing local setup as the bootstrap source after verifying key presence and checkout compatibility, so no Alice-owned setup step is currently known.

This is environment absence, not evidence about Content runtime performance. Shape does not repair it. Work should restore dependencies with the repo-pinned package manager, provision the local env without printing secrets, cold-start `dev:database`, and verify the root, database backend, and auth shape before taking a baseline.

### Work proving ground

Use a task-owned local database and deterministic fixtures through Content's normal action surface. The primary fixture should reproduce the captured table shape without production/customer data:

- 584 imported-looking rows;
- Name, Content, Author, and Date properties;
- one attached Builder-shaped source using fixture/read-only adapter data;
- queued body hydration with independently observable progress;
- representative review changes large enough to exercise complete-diff preparation;
- imported rows with useful body content plus later metadata;
- stable ownership marker and an explicit local cleanup/absence check.

Run the real local UI for create/open, attach, reveal property, sort, reorder, rename, row open, settings, and review. Measure browser intent -> first paint -> useful state -> action acknowledgement -> settled background state. Pair those marks with `action.response` request IDs and named server phases. Repeat cold and warm cases after every material optimization so the lane works the measured waits downward rather than relying on one favorable run.

Local acceptance proves application behavior under a controlled database/source fixture. It does not by itself prove production database latency, cold platform startup, or live Builder provider behavior; those remain separate destination evidence for Land.

### Correlated instrumentation protocol

Every performance run must produce one joined record from the user's gesture through the action/server path to the visible UI result. A fast server log without a fast screen is not a pass; a fast optimistic paint without acknowledgement or truthful settlement is not a pass either.

For each operation, capture the same correlation identity across:

1. **Intent:** pointer/keyboard gesture and browser monotonic timestamp.
2. **Immediate visual response:** shell, optimistic paint, retained rows, or explicit progress state.
3. **Client transport:** action name, request ID, request start, time to first byte, response completion, response bytes, and invalidations/refetches caused by that gesture.
4. **Server phases:** access, database connection, count/items, documents, properties/rollups, each attached-source snapshot and consistency retry, federation, review-diff preparation, serialization, and total duration.
5. **Useful visual state:** the semantic UI condition Alice can act on, such as real rows visible, sorted order visible, article body present, or first review changes present.
6. **Acknowledgement:** mutation success or typed failure, including rollback when applicable.
7. **Settled background state:** source/body hydration or complete review work, reported separately from the earlier useful state.

Use the existing Core `action.response` telemetry and Server-Timing/request IDs before adding new machinery. Temporary probes may add named phase durations and query/row/retry counts where the existing event is too coarse. Browser marks must be paired with semantic UI assertions and timestamped screenshots or video checkpoints from the same run. The visual clock and log clock must be joined through the interaction/request identity and a recorded run-start offset; do not correlate by eyeballing two unrelated timestamps.

The measurement report for one gesture should therefore read as a single waterfall, for example:

`gesture -> optimistic/shell paint -> request -> server phases -> response -> useful UI -> acknowledgement -> background settled`

The acceptance budget is judged on the relevant visual boundary. Logs diagnose which phase consumed that time; they do not redefine success.

### Temporary-probe hygiene

- Gate verbose phase logging to the local performance environment and task-owned fixture.
- Record identifiers, durations, counts, status, and coarse error classes; do not log document bodies, source payloads, credentials, or customer data.
- Keep an explicit inventory of every temporary probe and its purpose.
- Before the Work artifact is handed to Land, either remove each probe or deliberately promote a low-overhead, content-free measurement into the existing observability surface with tests and documentation.
- Verify the final diff contains no forgotten debug logging, local-only flags, fixture IDs, or accidental timing behavior.
- Re-run the clean production-like workflow after temporary probes are removed or disabled, because instrumentation overhead can otherwise become the last performance bug. The stopwatch has occasionally eaten the runner.

## Frozen Implementation Plan

### Exact acceptance fixture

The live provider fixture is the isolated Builder collection Alice used in the clip:

- visible Builder model label: **`Agent Native Blog Article Test`**;
- canonical Builder model name: **`agent-native-blog-article-test`**;
- expected scale: the clip showed **584 rows**;
- direct code corroboration: Builder model discovery deliberately prioritizes the canonical name `agent-native-blog-article-test` in `actions/_builder-cms-read-client.ts`;
- authority: Alice explicitly identified this as the disconnected test collection and authorized writes because it does not feed another product surface.

The display label or model name alone is not mutation authority. At Work activation, call the read-only `list-builder-cms-models` action and require exactly one result whose `name` and `displayName` match the pair above. Persist its returned Builder model `id`, row count, and a marker-absence baseline in the run ledger. A missing, duplicate, renamed, or differently identified model fails closed before any Builder write.

Existing collection rows are a read-only scale corpus. Provider mutations are limited to task-created rows whose title contains a run-unique marker such as `__an_content_perf_<run-id>__`. Work must never bulk-edit or delete the existing 584-row corpus, never delete the model, and never use an unmarked row for mutation acceptance.

Use two additional task-owned local fixtures through Content actions:

- a **1,000-row** SQL database with the same Name, Content, Author, and Date shape;
- a **5,000-row** SQL database with deterministic values and enough matching/non-matching rows to exercise search, filter, and sort boundaries.

These local fixtures establish scaling independently of live Builder/provider variance. They contain synthetic text only and are deleted with an independent absence check before Work completes.

### Delivery slices

#### Slice 0 — restore the proving ground and capture the old path

1. Use the current worktree and repo-pinned `pnpm@10.29.1`; restore dependencies without changing branches or printing secrets.
2. Provision the Content local database environment from the compatible canonical checkout configuration without copying values into logs or source.
3. Start the real `dev:database` UI, verify the local database/auth/provider shape, resolve the exact Builder model identity read-only, and create the task-owned local database plus one marked Builder row only after the Work resource gate is active.
4. Run the complete operation ledger once on the unchanged path. Save a joined browser/server waterfall, semantic screenshot checkpoints, action request IDs, response sizes, SQL/query counts, and the old visual durations. This is the comparison baseline, not an acceptance pass.

#### Slice 1 — correlated instrumentation

1. Add a Content-local timing collector for `get-content-database` and reuse the existing Builder timing collector for review/execute paths.
2. Instrument `actions/_database-utils.ts` with named spans for database/access resolution, count/page items, list-document projection, shares/favorites, properties/rollups, hydration status, source summaries/page overlays, federation, context, and serialization.
3. Instrument `actions/_database-source-utils.ts` with source ID/type, consistency attempt count, source rows scanned/returned, change-set/execution counts, body-field inclusion, and per-source duration.
4. Extend `actions/prepare-builder-source-review.ts` / `preview-builder-source-review.ts` timing around candidate discovery, authoritative target-row loading, body conversion/diff construction, validation, reconciliation, and response construction.
5. Add browser marks in `DatabaseView.tsx` at the actual intent handlers and semantic UI boundaries: shell/optimistic paint, first useful rows, stable sorted order, article body, first review changes, acknowledgement/rollback, and background settled.
6. Join browser marks to the existing Core action request ID and `action.response`/Server-Timing event. Change Core transport only if the existing request identity cannot be surfaced to the Content mark; do not invent a second unrelated trace ID.

The Work ledger must inventory each temporary probe. Logging remains local/preview gated and content-free. Remove it before the clean final replay, except for low-overhead counts/timings deliberately promoted into existing telemetry with tests.

#### Slice 2 — make the basic table read page-bounded end to end

1. Split the ordinary table projection from the complete source snapshot in `getContentDatabaseResponse`.
2. Query source metadata/status plus only the source rows needed for the returned document IDs. Do not call `getAllContentDatabaseSourceSnapshots` and then filter a complete corpus after the fact.
3. Keep full change sets, execution history, heavy Builder body values, consistency/reconciliation material, and full review payloads off the table-open critical path. Load them only through the source/review action that consumes them.
4. Parallelize independent list reads after access and visible item IDs are known, while retaining typed failures. An unavailable source projection must remain distinguishable from a valid source with zero rows.
5. Return and assert page diagnostics in local timing only: requested limit, database rows scanned/returned, source rows scanned/returned, attached source count, query count, response bytes, and sequential critical-path database round trips.

Primary files: `actions/_database-utils.ts`, `actions/_database-source-utils.ts`, `actions/get-content-database.ts`, `shared/api.ts`, and focused database/source tests.

#### Slice 3 — stop sort/filter/search from becoming a 5,000-row client fetch

1. Extend the existing `get-content-database` action contract with typed table-query inputs for search, active filters, sort order, and page cursor/limit. Keep this on the action surface; do not add a REST twin.
2. Apply table constraints in portable Drizzle queries and return one bounded result page plus truthful total/more state. Add only additive indexes demonstrated by query plans on hot membership/property/sort columns; no destructive schema changes or dialect-specific app calls.
3. Remove the `DatabaseView.tsx` behavior that expands a constrained table request to as many as 5,000 rows and maps the entire result into React.
4. Retain the current rows while a changed query is in flight. A sort gesture immediately updates the control and either reorders cached-complete data or keeps the prior rows visible until the bounded server result commits; it never swaps the table for `Loading database`.
5. Preserve the legacy behavior for board/calendar/timeline semantics unless the same portable query contract can represent them without changing product meaning. They must not regress, but the frozen latency target is the large **table** workflow shown in the clip.

Primary files: `actions/get-content-database.ts`, `actions/_database-utils.ts`, schema/query helpers and additive migrations only if traces require them, `app/hooks/use-content-database.ts`, `DatabaseView.tsx`, and view/query unit plus database tests.

#### Slice 4 — make routine writes bounded and optimistic

1. Inventory every operation in the approved ledger and record its current mutation response shape and invalidation set.
2. For create/name, reveal property, edit value, reorder columns, rename database, and row operations, paint the exact optimistic delta within 100 ms with rollback state retained.
3. Replace complete or unpaginated post-write database reconstruction with the smallest typed delta or the caller's current bounded page. Do not return a plausible empty/success state when reconstruction fails.
4. Set `skipActionQueryInvalidation` only where the hook applies an exact cache update. Keep Core other-tab, agent/script, and external-source invalidation behavior intact.
5. Assert one gesture's action count, cache writes, invalidations, and follow-up reads so a write cannot regress into `write -> full response -> broad invalidate -> full refetch`.

Primary files: the relevant database mutation actions, `app/hooks/use-content-database.ts`, `app/hooks/use-document-properties.ts`, and Core `use-action` only if a framework-level invalidation defect is directly demonstrated.

#### Slice 5 — make attach, hydration, row open, and Builder review progressive

1. Attach returns the source binding and first page of lightweight metadata quickly; continuation fetches remaining metadata in bounded pages without blocking table interaction.
2. Keep heavy Builder body fields in the existing durable hydration queue. Expose queued/progress/error counts truthfully and process bounded batches until all 584 bodies settle or a typed partial failure is visible.
3. Opening an imported row renders the shell immediately and loads its one authoritative body independently from later metadata/Yjs readiness.
4. Opening Builder review renders a local shell immediately, requests only the first review page/candidate summaries, and progressively loads full body diffs for visible or selected changes. `prepare-builder-source-review` must not rebuild an unpaginated database response after validation.
5. Preserve exact Builder target identity, change-set state, publication transition checks, dry-run/live-write gates, and reconciliation behavior. Performance is not permission to make review truth approximate.

Primary files: `actions/_database-source-utils.ts`, refresh/hydration actions, `preview-builder-source-review.ts`, `prepare-builder-source-review.ts`, `app/hooks/use-content-database.ts`, and the Builder review/hydration portions of `DatabaseView.tsx`.

### Measurement and acceptance loop

Each slice follows the same loop: clean baseline -> one bounded change -> focused tests -> real browser replay -> joined waterfall -> compare against the prior run. Work continues until every operation in the approved budget table passes or a material architecture/acceptance change returns the lane to Shape.

For warm operations, run ten repetitions after one discarded warm-up and require the approved target at p95. For cold table/row opens, run three fresh browser-context repetitions and require each to meet the 2-second target, with framework startup recorded separately rather than silently subtracted. Attach/hydration/review are repeated three times because they mutate durable local state; each run gets a fresh task-owned local database and clean source binding.

Every measurement row contains:

- fixture identity and row count;
- cold/warm classification;
- gesture and browser monotonic time;
- request ID and action name;
- shell/optimistic, first-useful, acknowledgement, and settled timestamps;
- server phase durations, query/row/retry counts, response bytes, and action/refetch count;
- semantic assertion and same-run screenshot/video checkpoint;
- pass/fail against the approved operation budget.

Acceptance must cover the exact 584-row Builder fixture and synthetic 1,000/5,000-row SQL fixtures. A fast synthetic fixture cannot substitute for the Builder run; provider time cannot excuse a table path that reads the entire provider corpus. Conversely, the live collection is not used to manufacture 5,000 remote records.

### Verification gates

Work is complete only when all of these are current on the exact artifact:

- focused unit/database tests prove page-bounded source reads, portable table constraints, typed failure states, bounded mutation responses, exact invalidation counts, hydration continuation, and progressive review scoping;
- `pnpm test` for Content passes;
- `pnpm typecheck` and `pnpm build` pass;
- modified source is formatted with oxfmt;
- the real local UI passes the operation ledger at the approved numbers;
- a production-like branch preview repeats the large-table acceptance with the new path and no temporary instrumentation overhead;
- an off-path/regression pass covers sharing/access, multi-source federation, other-tab/agent refresh, optimistic rollback, source-review identity/state, Builder validation failures, and Yjs row editing;
- the final diff contains no bodies/secrets, hard-coded returned Builder IDs, fixture markers, forgotten debug logging, or local-only performance switches;
- every task-created local and Builder resource is independently proven absent.

No production performance claim may be made from unit tests, server logs alone, or a visually fast optimistic paint without acknowledgement. Local and preview evidence are reported separately.

### Risk and rollback strategy

The frozen strategy is **system-ready**, not a permanent production feature flag. This change preserves an existing public action/product contract and must be fully accepted before merge; merging an unaccepted dormant alternative would only move the uncertainty downstream. During Work, an explicitly local, temporary benchmark switch may compare old and new read implementations against the same fixture, but it is not a rollout mechanism and must be removed before Work completion.

Keep each slice reversible in review: timing only, table projection, constrained queries, mutation deltas, then progressive source/review. If a slice fails correctness or its acceptance budget, revert that slice's implementation while preserving its measurements and continue from the last passing boundary. No migration may require rollback by dropping or renaming data.

Stop and return to Shape if meeting the target requires changing the action architecture, source-review truth model, public table semantics, named shipping surface, accepted budgets, or system-ready risk strategy. Fail closed before provider writes if the Builder model identity or task-owned marker boundary cannot be proven.

## Sources

- Local Clips Screen Memory status, chapter search, recent-context OCR, contact-sheet attempts, and exact-frame attempt on 2026-07-28.
- Public 16:01 Clips recording `BfEnyRiC4Pu7`, inspected at five-second intervals with key visible state boundaries recorded above.
- Current checkout `9d16c580b` under `templates/content` and `packages/core`.
- `templates/content/actions/get-content-database.ts`
- `templates/content/actions/_database-utils.ts`
- `templates/content/actions/_database-source-utils.ts`
- `templates/content/actions/_property-utils.ts`
- `templates/content/actions/create-content-database.ts`
- `templates/content/actions/add-database-item.ts`
- `templates/content/actions/configure-document-property.ts`
- `templates/content/app/components/editor/database/DatabaseView.tsx`
- `templates/content/app/hooks/use-content-database.ts`
- `templates/content/app/hooks/use-document-properties.ts`
- `packages/core/src/client/use-action.ts`
- `packages/core/src/client/use-db-sync.ts`
- Prior Content slow-network route and property-save isolation research, revalidated against the current checkout before use.

## Lifecycle

```yaml
stage: work
ledger-revision: work-2026-07-30-four-failures-v1
authority-source: >-
  Alice invoked $work on 2026-07-30 after approving the four remaining
  operation budgets and reconnecting the PR #2522 deployment to the isolated
  Builder test collection used in clip BfEnyRiC4Pu7
authorized-scope:
  repositories:
    - /Users/alicemoore/.codex/worktrees/8c63/agent-native
  product-surfaces:
    - Agent Native Content large database table UI
    - Builder-backed Content source attach, hydration, row, and review surfaces
  outcome: >-
    Make ordinary Content table operations on Builder-backed and SQL databases
    over 500 rows meet Alice's approved visual and acknowledgement budgets
allowed-mutations:
  - artifact-write
  - ephemeral-test-resource
  - branch
  - commit
  - push
  - pull-request
  - deploy
  - schema
write-targets:
  artifacts:
    - /Users/alicemoore/.codex/worktrees/8c63/agent-native/plans/content-blog-table-performance-research.md
execution-lane:
  worktree: /Users/alicemoore/.codex/worktrees/8c63/agent-native
  branch: codex/content-large-database-performance
  refreshed-base: origin/main@58bdd10a7f60ba08c01fa425f836732c73c5f5b6
  remote-default-branch: origin/main
  calling-task-id: unavailable from current host surface
  parent-task-id: none
  descendants:
    - /root/hot_path_inventory
    - /root/performance_technical_review
work-progress:
  completed-slices:
    - page-scoped primary Builder rows, change sets, reviews, and executions
    - bounded table search, filter, and sort response pages with retained rows
    - bounded routine mutation responses with explicit created and duplicated rows
    - immediate page-scoped Builder review while authoritative review loads
    - exact federated-field fallback without expanding ordinary large tables
    - source-free setup projections and a 100-row fast path for fresh Builder attachment
    - personal sort persistence that preserves existing visibility rules without source snapshots
    - correlated loopback-only server and visible-row timing replay, with probes removed afterward
    - exact imported-document reload for Builder source binding and hydration
    - exact identity-based created and duplicated mutation response projections
  verification:
    - shared table-query TypeScript compilation passed
    - shared table-query focused Vitest passed
    - oxfmt and git diff whitespace checks passed
    - live PR review found four correctness defects; exact Builder binding and
      identity-based mutation response repairs were implemented
    - Content typecheck and 273 focused action, database, batching, table,
      sidebar, personal-view, source, and query tests passed on Node 26
    - independent repair review found no remaining P1 or P2 in the four paths
  pending:
    - exact read-only Builder model identity and marker-absence baseline
    - exact Builder-backed attach, hydration, property, and progressive-review acceptance
    - independent human QA on a host that exposes the in-app browser
    - final repair verification, exact-head PR prose receipt, review, and CI
temporary-probes:
  - id: content-four-failure-action-phases
    status: active
    gate: PR #2522 preview and isolated local performance runtime only
    records: >-
      content-free phase names and durations for Builder attach preview,
      primary attach, metadata continuation, body hydration batches, and
      constrained table pages; action responses carry the same timing array
      so browser network evidence can be joined to the visible boundary
    removal-trigger: after the final joined preview acceptance replay
  - id: content-four-failure-browser-network-waterfall
    status: active
    gate: browser developer timing capture during the frozen H1-H5 replay
    records: >-
      pointer intent, semantic row/progress state, action URL, request and
      response timestamps, x-agent-native-request-id, status, and response
      timing phases; no bodies, credentials, or provider payloads
    removal-trigger: after the final joined preview acceptance replay
  - id: content-database-response-trace
    status: removed
    gate: >-
      CONTENT_DATABASE_PERFORMANCE_TRACE=1 on a verified loopback action request
    records: >-
      trace ID, phase durations, requested and returned row counts, source row
      and change-set counts, per-source duration, consistency attempts, review
      count, and execution count; no titles, bodies, provider payloads, or secrets
    removal-trigger: after the final joined acceptance replay
  - id: content-database-visible-row-trace
    status: removed
    gate: response carries content-database-response-trace
    records: >-
      response trace ID, local interaction ID, intent-to-row-commit duration,
      server duration, and returned item count
    removal-trigger: after the final joined acceptance replay
test-resources:
  - id: builder-perf-entry-agent-native-blog-article-test
    kind: record
    surface: >-
      Builder model name agent-native-blog-article-test, expected display name
      Agent Native Blog Article Test, exact returned model ID recorded read-only
      before activation
    ownership-marker: __an_content_perf_<run-id>__ in every task-created title
    baseline: >-
      list-builder-cms-models returns exactly one matching model and a provider
      list query returns zero entries carrying the run marker before creation
    allowed-actions:
      - create
      - update
      - exercise
      - delete
    cleanup-trigger: after each live-provider acceptance run and before Work completion
    cleanup-method: >-
      delete every exact returned Builder entry ID created with the run marker;
      never delete the model or pre-existing corpus
    cleanup-proof: >-
      independent reads show every returned entry ID absent and zero entries
      matching the run marker
    shared-impact: none
    isolation: isolated-test-surface
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - Alice identified this disconnected collection as freely writable test data
      - code recognizes canonical model name agent-native-blog-article-test
      - trusted read-only model discovery must bind the exact returned provider ID
    max-lifetime-minutes: 1440
    declared-at: 2026-07-29T19:00:06Z
    expires-at: 2026-07-30T19:00:06Z
    status: declared
    phase: work
  - id: content-large-database-local-fixtures
    kind: database
    surface: >-
      task-owned local Content databases marked __an_content_perf_<run-id>__
      with deterministic 584, 1000, and 5000 row fixtures
    ownership-marker: __an_content_perf_<run-id>__ database and row titles
    baseline: no local database or document carries the run marker
    allowed-actions:
      - create
      - update
      - exercise
      - delete
    cleanup-trigger: after each destructive acceptance run and before Work completion
    cleanup-method: delete task-created databases through Content actions
    cleanup-proof: >-
      list/search actions and scoped database reads independently report no
      database, document, or row carrying the run marker
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - local database runtime and unique task marker
      - creation result IDs retained in the resource ledger
    max-lifetime-minutes: 1440
    declared-at: 2026-07-29T19:00:06Z
    expires-at: 2026-07-30T19:00:06Z
    status: cleaned
    active-run-id: 20260729_1715
    active-resources:
      - kind: sqlite-runtime
        path: /tmp/agent-native-content-perf.GnFBS0/app.db
        state: removed-after-marker-free-proof
      - kind: content-database
        database-id: TYhMNt9YVgjW
        document-id: YXN4WiFhHCo0
        title: __an_content_perf_20260729_1715__ 1000 rows
        intended-row-count: 1000
        state: permanently-deleted
      - kind: content-database
        database-id: pyehc2Pq3FT1
        document-id: 4h6N49c1GNkj
        title: __an_content_perf_20260729_1715__ 5000 rows
        intended-row-count: 5000
        state: permanently-deleted
      - kind: content-database
        database-id: FLeIYkBrKXeC
        document-id: 4UiIEVdifuyF
        title: __an_content_perf_20260729_1715__ 584 rows
        intended-row-count: 584
        state: permanently-deleted
    cleanup-completed-at: 2026-07-30T03:58:00Z
    cleanup-observation:
      - >-
        Content action-backed UI soft-deleted database IDs TYhMNt9YVgjW,
        pyehc2Pq3FT1, and FLeIYkBrKXeC with their exact root documents.
      - >-
        permanently-delete-document removed root IDs YXN4WiFhHCo0,
        4h6N49c1GNkj, and 4UiIEVdifuyF with 1001, 5001, and 585 subtree
        documents respectively.
      - >-
        list-content-databases and search-documents returned zero marker
        matches; get-content-database returned typed not_found for all three
        exact database IDs; read-only SQL corroborated zero marker documents,
        fixture databases, and fixture roots.
      - >-
        The marker-free SQLite runtime and generated task-local Content env
        file were moved to macOS Trash and their original paths verified absent.
    phase: work
governing-artifact:
  path: /Users/alicemoore/.codex/worktrees/8c63/agent-native/plans/content-blog-table-performance-research.md
  revision: shape-blog-table-latency-r5
architecture-fingerprint:
  outcome: >-
    Large Content tables remain immediately usable and meet the approved
    operation budgets at 584, 1000, and 5000 rows
  shipping-surfaces:
    - id: agent-native-content-large-table-performance
      repository: /Users/alicemoore/.codex/worktrees/8c63/agent-native
      product-surface: Agent Native Content database table and Builder source workflow
      constituency: >-
        source-blind developers and Content users working with databases over
        500 rows, including Builder-backed tables
      durable-destination: merged Agent Native public repository implementation
      integration-action: merge
  governing-architecture: >-
    Content actions remain the single UI/agent data surface; ordinary table reads
    use persisted SQL page projections, provider/body/review work stays progressive,
    and client caches apply bounded optimistic deltas with truthful rollback
  acceptance-story:
    id: content-large-table-approved-budgets-v1
    summary: >-
      On the exact isolated 584-row Builder model and deterministic 1000/5000-row
      SQL fixtures, Alice can create/open a table, attach the source, reveal/edit
      properties, sort, open a row, return, and review Builder changes without a
      blank interface and within the approved budget table in this artifact
    required-assertions:
      - gesture-to-shell or optimistic response is at most 100 ms where specified
      - warm reads and acknowledgements meet 1 second and cold paths meet 2 seconds where specified
      - sort retains rows and settles within 500 ms warm or 1 second cold
      - attach shows first useful rows within 2 seconds and hydration never blocks interaction
      - 584-row metadata settles within 10 seconds and bodies within 30-60 seconds in the background
      - Builder review shows first changes within 2 seconds and full or progressive diff within 10 seconds
      - every gesture has one correlated visual/client/server waterfall and bounded action/refetch count
      - work scales with requested page or selected review scope rather than complete corpus size
      - typed failure, access, sharing, federation, sync, rollback, Yjs, and Builder review truth remain correct
      - all temporary probes and task-created resources are removed with current independent proof
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: >-
    The work changes shared Content action response composition, source projection,
    query pagination, cache invalidation, and Builder review boundaries
  status: grounded
  demonstrated-callers:
    - Alice's 584-row Builder-backed Blog table workflow in clip BfEnyRiC4Pu7
    - get-content-database called by DatabaseView with a 100-row initial limit
  existing-primitives:
    - defineAction plus useActionQuery/useActionMutation
    - persisted Content SQL source rows and body hydration queue
    - Core action.response request IDs and Server-Timing
    - Builder source timing collector and review actions
    - Core useDbSync current-tab echo suppression and targeted invalidation hooks
  ownership-boundaries:
    - Core owns action transport, request identity, timing headers, and DB-sync mechanics
    - Content owns database projection, pagination, source/review state, hydration, and optimistic cache policy
    - Builder owns provider content; only the exact isolated test model is writable in acceptance
  legacy-contracts:
    - action surface parity for UI and agent callers
    - ownable-data access and sharing scope
    - truthful multi-source and review/change-set state
    - other-tab and agent/script refresh
    - optimistic rollback and authoritative Yjs document behavior
  shared-vocabulary:
    - first useful
    - acknowledgement
    - settled background state
    - page-bounded table projection
    - progressive Builder review
  smallest-compatible-delta: >-
    Page-bound get-content-database source overlays and table constraints before
    changing mutation/review response shapes; no broad cache or sync rewrite
  deferred-capabilities:
    - general query planner for every database view type
    - redesigned infinite scrolling
    - rollup engine rewrite
    - new real-time transport
    - provider live reads on ordinary table render
  reversibility: >-
    Six ordered slices isolate environment/baseline, timing, read projection,
    constraints, mutations, and progressive provider work; all schema changes are additive and each slice
    can be removed without deleting user data
  direct-evidence:
    - clip operation ledger and approved budgets in this artifact
    - getContentDatabaseResponse loads complete source snapshots before page filtering
    - DatabaseView expands constrained reads to 5000 and renders items with map
    - Builder review timing already names snapshot/diff and reconciliation phases
    - model discovery prioritizes canonical name agent-native-blog-article-test
  inferences:
    - relative contribution of source snapshots, query waterfalls, payload, and React commit before joined baseline
  unresolved-owner-questions: []
delegation-ceiling:
  - read-only
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: >-
    The implementation and synthetic fixtures work without Alice's vault or
    credentials; her isolated Builder model supplies provider acceptance only,
    not a runtime dependency or hard-coded identity
  bowerbird-product-boundary: not-applicable
acceptance-state:
  status: blocked
  summary: >-
    Local implementation, deterministic large-database acceptance, repair
    verification, independent technical review, and resource cleanup are
    complete. Exact Builder-provider acceptance and independent human QA remain
    unproved, so the system-ready risk strategy prohibits merge and closure.
  local-evidence:
    - >-
      5000-row warm open, ten settled repetitions: first useful React commit
      146-189 ms; correlated server read 5-12 ms; 100 of 5000 rows returned
    - >-
      5000-row Date sort, ten repetitions: existing rows remained visible and
      the sorted paint completed in 272-285 ms
    - >-
      representative 1000-row and 584-row opens committed 100 useful rows in
      217 ms and 210 ms respectively, with 12 ms and 6 ms server reads
    - >-
      584-row row preview showed shell, metadata, and synthetic authoritative
      body within 526 ms including browser-control overhead
    - >-
      Final local replay retained 100 of 5000 rows through Date sort reversal
      and opened the first row preview with Author, Date, and authoritative body
    - >-
      final ABI-matched verification: Content typecheck and 228 focused action,
      batching, table, sidebar, personal-view, and query tests passed
    - >-
      post-review repair verification: Content typecheck and 273 focused tests
      passed, including exact imported Builder binding, sparse-position
      duplicate projections, and concurrent exact created-item responses
  blockers:
    - >-
      The isolated local runtime has no Builder vault credential, so the exact
      Agent Native Test Blog model identity, attach/hydration, and progressive
      review budgets cannot yet be accepted against the provider fixture.
    - >-
      Independent human QA preflight was blocked before H1-H5 because the tester
      host did not expose the in-app browser; no frozen-test action was executed.
      Exact-head PR prose, review, and CI must refresh after the repair commit.
  cleanup-evidence:
    - >-
      The first file-only cleanup was audited and rejected because the restored
      database still contained every marker row. The exact fixture was then
      recovered and cleaned through Content actions: all three database roots
      were soft-deleted, permanently deleted by exact document ID, and proved
      absent through list/search/not-found action reads plus corroborating SQL.
    - >-
      After action-level marker-absence proof, the stopped marker-free runtime
      and regenerated task-local Content env file were moved to macOS Trash and
      their original paths were verified absent; ambiguous older Trash env files
      were preserved untouched.
    - >-
      Removed the environment-gated server phase trace, source snapshot trace,
      response trace fields, and correlated browser console timing after the
      final joined replay; no temporary Content performance probe remains.
  last-land-packet:
    observed-at: 2026-07-30T04:13:17Z
    artifact-revision: land-audit-blocked-r8
    passed: >-
      deterministic 584/1000/5000-row browser budgets; Content typecheck and
      273 focused tests; exact imported-row and identity-projection repairs;
      independent no-P1/P2 repair review; 28 exact-head CI checks with zero
      failures at observation time; action-level fixture marker-absence proof
    missing-acceptance-evidence:
      - >-
        exact isolated Builder model identity, attach, hydration, property,
        row, and progressive-review budgets on a credentialed runtime
      - >-
        frozen H1-H5 independent human QA on a host exposing the in-app browser
      - >-
        two CI jobs were still pending at the observation time, and the
        external Review Agent skipped the repair rerun
    feature-flags: >-
      none; the frozen system-ready strategy has no code-ready-only or off-state
      merge fallback
    repository-governance: not-satisfied
    independent-technical-review: evidenced
    acceptance-story: not-satisfied
    merge-permitted: false
    enablement-permitted: false
    may-call-shipped: false
    task-may-close: false
    readiness: blocked
status: active
```

Frozen-five status: **frozen at `shape-blog-table-latency-r5`**.

Output: `/Users/alicemoore/.codex/worktrees/8c63/agent-native/plans/content-blog-table-performance-research.md`

Authority: Land under `land-blog-table-latency-r8`. Bare Land carries the frozen
PR merge action, but the persisted no-go packet prohibits exercising it. No
Builder record, branch operation, deployment, merge, cleanup, or archival was
performed by Land.

Invalidated by: a change to the approved outcome/budgets, named Agent Native Content shipping surface or constituency, action/SQL/progressive-provider architecture, acceptance story, or system-ready risk strategy.

Task attention: `autonomous`; the connected PR preview and in-app browser are
available for the four-failure Work loop.

Next: deploy the exact Work artifact to PR #2522, run correlated exact-provider
acceptance, remove temporary probes, and replay the clean artifact before Land.

## Work result — 2026-08-01

The credentialed local replay now satisfies all four frozen performance budgets
against the read-only `Agent Native Blog Article Test` Builder collection:

- first useful rows after Attach: **88 ms** (target ≤2 s)
- complete 584-row metadata acknowledgment: **8.66 s** (target ≤10 s)
- terminal body synchronization: **30.20 s** (target ≤60 s; 582 hydrated,
  two genuinely bodyless rows resolved as unavailable, no leased repair jobs)
- cold Date sort acknowledgment: **434 ms** (target ≤1 s; 100 of 584 rows
  retained and sorted result painted)

The final clean artifact contains no temporary timing probes. Content typecheck,
102 focused database/cache tests, the full 2,003-test suite (including three
expected failures and five skips), and the production build pass locally. Exact
PR-preview deployment and independent hosted H1-H5 acceptance remain the next
Land gates; these local results do not substitute for them.
