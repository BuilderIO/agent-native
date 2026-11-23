# Product differences

## Personal Skills in Settings

Workspace members can open Skills from the Account section in Settings, create
and upload personal skills, and browse the shared skills their existing access
allows. This follows the explicit member-access product decision. The page uses
the framework's resource permissions and upload controls; workspace administration
rights are not required to manage personal skills.

## Neutral contact and documentation

Connection setup uses our support contact and documentation destinations. The
help sentence, link labels, link order and layout follow the connection picker.
This mandatory branding replacement applies in the default appearance.

| Control       | Destination                                   |
| ------------- | --------------------------------------------- |
| Support email | `mailto:support@builder.io`                   |
| security page | `https://www.agent-native.com/docs/security/` |
| documentation | `https://www.agent-native.com/docs/`          |

The contact is published on Builder's Help and Support page. The two documentation
pages were verified directly. QA checks link targets without opening a mail draft
or contacting anyone. Copy replacements are recorded in `copy-rewrites.json`.

Verification: `app/components/data/footer.spec.tsx`. This candidate still requires
a fresh visual comparison; this entry does not certify its appearance.

## Notebook Variables panel

The Variables panel lists the result variable of each run cell from the project's
saved output (name, rows x columns, owning cell). This build has no server
kernel, so the panel cannot list a kernel's live namespace; it shows the same
saved result the cell itself displays and never invents a variable.

## Notebook host capture refresh — sidebar and shell

Upstream `2a8d0b1ac0` enabled the backed Variables panel in the notebook tool rail. These captures were taken again from the unchanged host at export base `9f402b843234503e42758f1f633a7013cb4b2c66`, never from a reference renderer. The notebook remains excluded re-token scope; no host mounts or renderer coverage are added.

**Reference impact:** Capture evidence follows the landed host. The private Sidebar/AppShell renderers remain unmounted. Existing dispositions above are retained.

- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-data-browser-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-data-browser.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-find-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-find.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-help-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-help.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-history-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-history.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-toc-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-toc.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Added `app/testing/sidebar-shell/__goldens__/notebook-agent-variables-surface.json` for `2a8d0b1ac0`: rail buttons 0 → 6.
- Added `app/testing/sidebar-shell/__goldens__/notebook-agent-variables.json` for `2a8d0b1ac0`: rail buttons 0 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-data-browser-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-data-browser.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-find-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-find.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-help-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-help.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-history-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-history.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-toc-surface.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-toc.json` for `2a8d0b1ac0`: rail buttons 5 → 6.
- Added `app/testing/sidebar-shell/__goldens__/notebook-no-agent-variables-surface.json` for `2a8d0b1ac0`: rail buttons 0 → 6.
- Added `app/testing/sidebar-shell/__goldens__/notebook-no-agent-variables.json` for `2a8d0b1ac0`: rail buttons 0 → 6.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent.json` for `2a8d0b1ac0`: rail buttons 5 → 6.

Expectations: `app/testing/sidebar-shell/notebook.spec.tsx` rail count 5 → 6, exact ordered label list added, toggled panels 5 → 6 in each agent state, and Variables panel identity/empty-state assertions added (4 → 7 assertion statements). All previous toggle/callback assertions remain. `app/testing/sidebar-shell/captures.json` refreshes 12 surface hashes and adds 2 Variables surfaces (12 → 14 notebook surfaces); hash, row-presence and envelope checks are unchanged. Frozen JSON count 552 → 556: 24 refreshed, 4 added, remaining 528 byte-identical.

## Notebook Components host capture refresh

Upstream `4b2f179be4` adds the Components button after Variables in the notebook tool rail. These captures were retaken from the unchanged host at export base `95434b59b47321bbc86d4ec6974de24b90a849bf`, with the existing fenced local-test capture switch, never from a reference renderer. Only the stale files listed below were deleted for retaking; predecessor bytes are retained in private evidence. Removing only the new Components button from each refreshed capture reproduces its entire predecessor JSON exactly; no other upstream host change appeared. The notebook remains excluded host-rendered scope; the 114-row denominator and unmounted reference renderers are unchanged.

- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-data-browser-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-data-browser.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-find-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-find.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-help-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-help.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-history-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-history.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-toc-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-toc.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-variables-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent-variables.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-agent.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-data-browser-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-data-browser.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-find-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-find.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-help-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-help.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-history-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-history.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-toc-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-toc.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-variables-surface.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent-variables.json` for `4b2f179be4`: rail buttons 6 → 7.
- Refreshed `app/testing/sidebar-shell/__goldens__/notebook-no-agent.json` for `4b2f179be4`: rail buttons 6 → 7.

- Added `app/testing/sidebar-shell/__goldens__/notebook-agent-components-click-surface.json` for `4b2f179be4`: Components click with seven rail buttons and no adjacent panel; this is a click-state capture, not a Components panel capture.
- Added `app/testing/sidebar-shell/__goldens__/notebook-agent-components-click.json` for `4b2f179be4`: Components click with seven rail buttons and no adjacent panel; this is a click-state capture, not a Components panel capture.
- Added `app/testing/sidebar-shell/__goldens__/notebook-no-agent-components-click-surface.json` for `4b2f179be4`: Components click with seven rail buttons and no adjacent panel; this is a click-state capture, not a Components panel capture.
- Added `app/testing/sidebar-shell/__goldens__/notebook-no-agent-components-click.json` for `4b2f179be4`: Components click with seven rail buttons and no adjacent panel; this is a click-state capture, not a Components panel capture.

Expectations: `app/testing/sidebar-shell/notebook.spec.tsx` retains every previous toggle/callback and Variables assertion, increases the exact rail count 6 → 7, and includes Components in the exact ordered labels. All six existing panels still open and toggle closed. Components reports `components` to the optional owner callback once per click and opens no rail panel; it also leaves an existing Variables panel in place. `ProjectEditor` forwards selection but excludes Components from panel selection; its real owner `NotebookPage` supplies no `onOpenToolRailItem`, so the click does nothing elsewhere today. This records host behavior, not a seventh panel requirement; retake when the host wires the panel. No host file was edited. Assertion statements 7 → 17. `captures.json` refreshes 14 existing notebook surface hashes and adds two Components-click states (14 → 16 notebook surfaces), preserving all previous entries and row/presence/envelope checks. Frozen JSON 556 → 560: 28 refreshed, 4 click-state files added, 528 other frozen files unchanged. No Components panel capture exists.

## Unmounted account image follow-up

**Reference impact:** `app/skins/reference/sidebar-shell/AccountImage.spec.tsx` only. Extends offline reference-renderer assertions for the existing frozen account-image and setup states or their coverage accounting. This test path does not mount or change a host or update a frozen capture.

**Reference impact:** `app/skins/reference/sidebar-shell/Sidebar.spec.tsx` only. Extends offline reference-renderer assertions for the existing frozen account-image and setup states or their coverage accounting. This test path does not mount or change a host or update a frozen capture.

**Reference impact:** `app/skins/reference/sidebar-shell/coverage.spec.ts` only. Extends offline reference-renderer assertions for the existing frozen account-image and setup states or their coverage accounting. This test path does not mount or change a host or update a frozen capture.

**Reference impact:** `app/skins/reference/sidebar-shell/menus.tsx` only. The unmounted private account menu now renders the typed optional account image and retains the existing Avatar fallback. No page imports or mounts this renderer, so the host reference experience is unchanged until host conversion; revisit this disposition then.

**Reference impact:** `app/testing/sidebar-shell/models/scoped-workspace.tsx` only. The sidebar/shell test model now supplies the typed optional account image; the workspace fixture also includes the existing frozen image state where applicable. This test support does not mount or change a host. Revisit at host conversion.

**Reference impact:** `app/testing/sidebar-shell/models/workspace.tsx` only. The sidebar/shell test model now supplies the typed optional account image; the workspace fixture also includes the existing frozen image state where applicable. This test support does not mount or change a host. Revisit at host conversion.

**Reference impact:** `app/testing/sidebar-shell/reference-coverage.json` only. Updates offline reference coverage or preserves historical accounting limits for the typed account-image follow-up. No host, frozen capture, mounted or strict coverage is changed; revisit at host conversion.

**Reference impact:** `app/testing/sidebar-shell/round3-reference-evidence.json` only. Updates offline reference coverage or preserves historical accounting limits for the typed account-image follow-up. No host, frozen capture, mounted or strict coverage is changed; revisit at host conversion.

**Reference impact:** `app/testing/sidebar-shell/round3-reference-summary.ts` only. Updates offline reference coverage or preserves historical accounting limits for the typed account-image follow-up. No host, frozen capture, mounted or strict coverage is changed; revisit at host conversion.

**Reference impact:** `app/testing/sidebar-shell/update-reference-coverage.ts` only. Updates offline reference coverage or preserves historical accounting limits for the typed account-image follow-up. No host, frozen capture, mounted or strict coverage is changed; revisit at host conversion.

## Notebook Components panel reachability

Contract `analytics-2#596` connects the existing Components panel from `4b2f179be4` to the rail's existing toggle. This supersedes the earlier no-panel capture state above: the real notebook page now opens Components without an owner callback, closes it on a second click or its close button, and replaces another open rail panel.

Retaken from the host with the fenced local-test capture switch:

- `app/testing/sidebar-shell/__goldens__/notebook-agent-components-click.json`
- `app/testing/sidebar-shell/__goldens__/notebook-agent-components-click-surface.json`
- `app/testing/sidebar-shell/__goldens__/notebook-no-agent-components-click.json`
- `app/testing/sidebar-shell/__goldens__/notebook-no-agent-components-click-surface.json`

These four captures now include the opened Components panel and its existing empty state. `captures.json` updates the two surface hashes and active-tool inputs. `notebook.spec.tsx` asserts all seven panels toggle, callback reporting, switching from Variables, the Components close button, and a registry entry on the real `NotebookPage` with action reads mocked. The four predecessor captures are retained in private evidence; the other 556 frozen JSON files are unchanged. No reference renderer, coverage denominator, route, or gate changes. This is mounted-host evidence; browser painting and authenticated action transport are not exercised.

## Project sharing

Project sharing uses workspace-scoped project ACLs. Owners can grant access to
workspace members; private projects remain inaccessible without a grant.
Readers and writers are checked against their respective roles. External and public
access, group shares, link scope, embedding, and delegation remain separate work;
this is not a complete reproduction of the reference Share surface.

## Context Studio description capture refresh

Upstream `23b931e530` added the description paragraph to the models host, and
`e97a4e420d` corrected its text. Under the standing frozen-host capture ruling,
the following captures were retaken from the real `ContextStudioPage` at the
corrected integration state:

- `app/testing/sidebar-shell/__goldens__/context-models.json`
- `app/testing/sidebar-shell/__goldens__/context-models-surface.json`
- `app/testing/sidebar-shell/__goldens__/context-nested-models.json`
- `app/testing/sidebar-shell/__goldens__/context-nested-models-surface.json`

Mechanical comparison of all 134 frame capture artifacts found exactly these
four changed files. Each has one insertion in its markup: the description
paragraph directly after the page title, using the exact host value at HEAD.
Removing that insertion reproduces the previous markup exactly; all other JSON
values and serialization remain unchanged. The upstream addition supplies the
paragraph and the subsequent correction supplies its current text.

The existing frame spec mounted the real host for both capture passes. Candidate
output first used the harness's missing-file capture switch with a temporary
scratch destination. After comparison, only these four existing files were
written with the same harness serialization and an explicit four-name allowlist.
The helper was restored byte for byte after each pass. The two affected surface
hashes in `captures.json` were updated. `frames.spec.tsx` adds a non-empty
description-paragraph assertion directly after the title without freezing text
in the assertion; every existing assertion remains. The reference renderer's
page-owned content slot stays empty by contract, so no renderer change is needed.
No host, Settings, page-imported, or package file changed.

## Context rail capture refresh after 0b0c63a0b8

- Retaken from the host with the fenced capture writer: `frame-context-studio-overview`, `context-{overview,suggestions,evals,endorsements,guides,models,repositories,knowledge,apps,nested-models,connections-first-render,connections-settled}`, each diagnostic and `-surface` capture (26 files). Commit `0b0c63a0b8` added the setup destination and related-settings footer; `48d5a9ee3f` describes those rows by behavior without changing their rendered state.
- The model captures keep the description introduced by `23b931e530` and corrected by `c5f171b6cc` / `e97a4e420d`. No other host change is frozen by this refresh.
- The Context view journey now requires eleven rail links, including enabled, named, keyboard-focusable anchors to setup, data and settings. Expectations avoid pinning their wording; existing destinations and gated-view checks remain.
- Strict comparison also requires the private `NavigationRails.tsx` renderer and test-only `models/rails.ts` to carry the new setup and footer sections from `0b0c63a0b8`. Existing byte-exact shell/rail and every-destination click tests remain unchanged and now cover those anchors; no host or public renderer changes.

## Settings skin expectations follow the landed host

Toolkit commit `5919e540eb9856108d218acd6044ee6a9c4fec26` associates the
house color picker's accessible name with its `Color` label and omits
`aria-expanded` on dialog actions whose body is supplied by the app. The three
Settings skin specs now record that host: workspace-name states agree exactly;
data-source states retain all three exact sort-state differences; asset-label
states retain the exact reference swatch-name versus house `Color` difference.
The selected color, choices, keyboard behavior, writes and recovery remain
independently exercised, with an additional exact-name assertion in both skins.
No renderer or captured markup changed in this expectation retake.

Host commit `784a2d585f388f3b7c64772045798abf13a2036f` lists unavailable
connection templates in the picker. The data-source journey now requires the
unavailable tile, its exact availability notice, no save, Back to both tiles,
and closing the dialog in both skins, replacing the obsolete absence check.

The notice currently joins `wascreated` in its final sentence; this retake
records that exact host text. A separate cosmetic host repair is deferred.

## Datasets field on the BigQuery connection form (sprint-analytics-2#812, 11-14)

The reference's BigQuery form has no datasets field: its credential validation
lists the project's datasets, which assumes a key that can see the whole project.
A service account scoped to individual datasets (the tester's six dbt datasets) is
refused that listing, so the same form cannot connect at all and, once it does,
the data browser would open empty. Our DATABASE section therefore carries one
extra text field, `Datasets` (COMMA SEPARATED). A configured list limits schema
browsing in the primary project. Refresh checks whether the saved key can list
tables in each named dataset. Leave the list empty when creating a connection
to browse the whole project. Editing an existing list requires at least one
dataset ID. Source read for the surrounding form: the
reference's own `AddDataConnection.tsx` schema sections (Schema browsing holds
only schema-refresh and table-preview toggles, so this field is not a rewritten
reference control). Known gap, recorded here rather than hidden behind a flag
because it sits on the tester path this row exists to unblock.

## Backlog batch 11 triage (static read, nothing executed)

This checkout has no installed workspace toolchain, so tests, typecheck, lint and guards could not run. Statuses come from reading current main.

Already present on main, needs a live re-check before closing (not-repro by code read):
578 (`project-query.db.test.ts` "runs sample joins without asking for a connection"), 582 (`en-US.ts` has `desktopNotificationsDescription`), 557 (`display-table` in `ADDABLE_CELL_KINDS`), 583 (`seed.ts` builds the chart from inline records), 474 (`workspace-search-suggestion-copy.spec.ts`), 520 (`archive-project`), 523 (`touch-project` from `NotebookPage`), 510 (`ProjectHeader.clearOutputs.spec.tsx`), 421 (`.ipynb` export in `ProjectHeader`), 420 (`ImportProjectDialog.spec.tsx`), 422 (`TransferProjectOwnerDialog.spec.tsx`), 423 (`ProjectStatusDialog`), 155/532 (`WorkspaceListColumnBorders.spec.ts`), 118 ("Created by you" in `ProjectsListView`), 484 (`ProjectsListView.layout.spec.tsx`).

Needs-info (cannot confirm statically; need a browser run): 580, 506, 233, 545, 471, 473, 533, 224.

Open, not fixed here: 534/536 (skills have no Trash surface or restore action; needs a new action plus Trash page section), 156/157/493 (profile photo and change-email controls come from the shared settings kit, outside this template).
