# Analytics daily-driver scope

Working scope, 2026-11-17. Core means retained and checked, not a claim of completion. Labs means an existing, at least partially implemented secondary capability; its entry points must be hidden by default and available when the shared app Labs toggle is enabled. Cut means no new replication work and omitted entry points; treat each omission as an intentional visual and navigation deviation. Setup, first-run and connection recovery remain core.

Sources: original navigation and settings labels in the archived source `src-current/pretty/298c12dc3434f75f2299682853d70f38caaf5ef84f8ef1a48207d6408c3087e7.js`, sharing/collections in `f0ad210fe8b760da5b670c37d5282f5c8d9997b76c67f40c6e362faa07798d77.js`; local route registry, shell, actions, `e2e/core-flows.ts`, and `v2/state/analytics-2.md`. Source paths are private evidence, not product UI.

## Core (20)

Flow IDs in `code` exist unless marked **new**; a new ID is a coverage requirement, not a passed check. S1–S5 refer to the screen list below. Multiple rows sharing a flow mean partial coverage only.

| #   | Daily capability                                                                    | Flow IDs                                                                                | Screens |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| 1   | Sign in, enter workspace and recover first-run setup                                | `setup-links`, `builder-native-authorization` (subcheck), `first-run-setup`, `SETUP-25`, `report-127-home-recovery`, `signed-in-landing-routes` | S1      |
| 2   | Discover connection setup from Home                                                 | `connect-your-data-entry`                                                               | S1, S2  |
| 3   | Configure and test a data connection                                                | `connect-data-source`                                                                   | S2      |
| 4   | Browse connected databases, schemas and tables                                      | **new** `browse-data-catalog`                                                           | S2      |
| 5   | Find a project or conversation via search                                           | **new** `search-workspace`                                                              | S1      |
| 6   | Browse recent and all projects                                                      | `open-dashboard` (partial)                                                              | S1      |
| 7   | Create a notebook project                                                           | `notebook-save-reload`, `new-project-interactive`, `report-1794947464-agent-view`       | S3      |
| 8   | Rename a project and persist it                                                     | `rename-persists`                                                                       | S3      |
| 9   | Open a project and restore its saved cells                                          | `open-dashboard`, `notebook-save-reload`                                                | S3      |
| 10  | Add and edit notebook cells                                                         | `notebook-save-reload`                                                                  | S3      |
| 11  | Rename a cell and persist it                                                        | `cell-rename-persists`                                                                  | S3      |
| 12  | Run SQL against sample data and see results                                         | `sample-sql-runs`                                                                       | S3      |
| 13  | Run SQL against the selected connected source                                       | `report-792-819-824-org-cell-persistence` (partial), `sql-connected-source-ui`          | S2, S3  |
| 14  | Save and reload notebook edits                                                      | `notebook-save-reload`                                                                  | S3      |
| 15  | Ask a data question in the agent conversation                                       | `ask-question-get-chart`, `agent-claim-readback`                                        | S3, S4  |
| 16  | Create and refine a chart from analysis                                             | `ask-question-get-chart` (create); **new** `refine-chart`; `chart-formatting`           | S3, S4  |
| 17  | Build and publish a dashboard from cells                                            | **new** `publish-dashboard`                                                             | S3, S5  |
| 18  | Open and interact with a published dashboard                                        | `open-dashboard` (partial); **new** `view-published-dashboard`                          | S5      |
| 19  | Organize work in collections and share published work with authorized collaborators | `organize-and-share`                                                            | S1, S5  |
| 20  | Configure Builder/native access, AI provider keys, and the HubSpot GTM credential   | `builder-native-authorization`, `setup-links`, `hubspot-key-and-test`                   | S1      |

`setup-links` checks the AI-provider settings link; `builder-native-authorization` is a separate native-host subcheck, and `hubspot-key-and-test` checks the HubSpot GTM credential. `first-run-setup` is in `e2e/first-run-local.ts`; `SETUP-25` is in `e2e/daily/setup.spec.ts`. Neither substitutes for a real new-admin fixture. Keep existing setup and native-authorization checks even when their fixture is unavailable: record COULD-NOT-RUN, never silently skip or report pass.

Home recent-work tabs and New thread: `report-1794900799-home-recents`.

Projects Title filter and workspace search accept over-long input without an error state, and Escape closes the search dialog after focus leaves its controls: `filter-limits-and-escape`.

Additional Core checks (a listed ID is coverage, not a passing verdict): `organize-collection-dialog`, `report-1795066971-input-menu`, `report-1795067325-input-config`, `report-1795071219-input-query`, `report-1795071321-input-adjacent`, `report-1795073129-input-dependencies`, `report-1795063839-data-browser-dialog`, `report-1795065529-sql-height`, `report-B-SAMPLE-RERUN-CANCELLATION-TOAST`, `report-QA-1795062135-project-status-categories`, `report-A2-PUBLISHED-CHART-STYLES`, `report-A2-ASK84-CUSTOM-DATE-RANGE`, `sample-sql-edge-cases`, `cell-delete-immediate`, `saved-result-paging`, `report-1794899464.159559-workspace-projects`, `report-1794900076.228569-home-focus`, `report-1794900494.750729-popular`, `report-1794913977.330369-bigquery-draft`, `demo-dispatch-chart`, `demo-mcp-chart`, `report-search-filters`, `report-M5-T2-F-03-users-settings`, `report-M5-T2-F-04-settings-search`, `report-M5-T2-F-01-keyboard-shortcuts`, `report-455-456-editor-preferences`, `report-A2-AUTOSAVE-RUN-DROPPED`, `report-published-app-search`, `report-project-list-columns`, `report-1794899960.825799-home-app-intent`, `report-1794899542.541439-notifications`, `report-1794899298.142179-library`, `app-intent-transport`, `report-pager-empty-continuation`, `report-1794900229.518749-home-create-collection`, `report-F12-query-error-reload`, `query-cancellation-transport`, `steve-demo-monthly-revenue`, `DATA-FAVORITES`, `default-connection-new-cell`, `sql-editor-affordances`, `result-preview`, `control-inventory`, `menu-viewport`, `billing-analysis-end-to-end`, `chained-sql-cell`, `parameter-query`, `markdown-text-cells`, `cell-reorder`, `version-history-restore`, `qa2-history-save-version-keyboard`, `qa2-publish-dialog-open-state`, `qa2-share-panel-staged-invites`, `download-csv`, `query-error-cancel`, `notebook-keyboard-shortcuts`.

## Labs (4)

| Capability                        | Existing implementation                                                    | Entry point and exclusion                                                    |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Scheduled agent tasks             | `TasksPage`, `create-scheduled-task`, `list-scheduled-tasks`               | Tasks sidebar `/home/tasks`; omit from core flow and visual checks.          |
| Reusable components catalog       | `ComponentsPage`, `list-components`, `manage-component`                    | More → Components `/home/components`; omit from core flow and visual checks. |
| Explorations catalog and creation | Home recent-work tab is Core; catalog and creation have no registered page | More → Explorations `/home/explorations` stays Labs.                         |
| Authentication administration     | `AuthenticationSettingsPage` bridges existing authentication settings      | Settings → Directory sync and SSO; omit from core flow and visual checks.    |

Tasks, Components, Explorations, Directory sync and SSO navigation use a temporary off switch, as do their direct UI routes. Wire this switch to the shared Labs toggle when it lands; default off. Verify alternate entries and direct routes in the running app before calling gating complete. The setup card and Context Studio connection setup are core and must not be hidden by this change. Existing saved objects must not be deleted. Route/action access and agent parity need a deliberate shared policy; hiding a menu alone is not proof of full gating.

## Cut (6)

These deferred capabilities have no registered app page in `app/components/workspace/pages.tsx`; related route names or shared framework capabilities may still exist. Omit their entry points when they are unsupported and record them as deviations; do not count them as missing in screen/style checks.

1. Explorations catalog and creation implementation (the route has no registered page; the existing navigation is Labs).
2. Advanced compute management (Settings → Compute).
3. Advanced environment management (Settings → Environment).
4. Governed-mode administration (Settings → Governed mode).
5. Standalone development tools and diagnostics (More → Agent Dev Tools).
6. `python-cell-run`: Python and R cell creation and execution. The current runner only executes SQL; existing code cells retain their source but cannot run. Do not count Python/R creation or execution in flow 5 until a runtime is implemented.

The SQL editor supports syntax highlighting, folding, optional line numbers, and persisted agent edit proposals with explicit accept/reject review. A changed user draft blocks acceptance until the conflicting proposal is rejected. Result previews support sorting, filtering, pagination and scrolling. Shared Editor grants still cannot write through the owner-only storage boundary; the notebook reports that current capability honestly. These implementations and open defects do not substitute for a complete core-flow receipt.

## Five priority screens

Target for each desktop capture: **under 1% pixel difference and at least 95% matched style elements** against equivalent original state, viewport and data. These are targets, not measured results. Exclude only the Labs/Cut entries listed above and documented mandatory branding; retain core controls in denominators. No baseline is certified here. Capture the original's narrow variant where responsive, and compare at the same viewport. Narrow-width behavior and original responsiveness are pending observation; do not assume a mobile layout.

| ID  | State                                         | Desktop | Narrow                                                     |
| --- | --------------------------------------------- | ------- | ---------------------------------------------------------- |
| S1  | Home with recent work, search and setup entry | pending | pending original responsive check, then same-width capture |
| S2  | Data browser and connection picker            | pending | pending original responsive check, then same-width capture |
| S3  | Notebook with SQL cell and result             | pending | pending original responsive check, then same-width capture |
| S4  | Question thread with chart                    | pending | pending original responsive check, then same-width capture |
| S5  | Published dashboard                           | pending | pending original responsive check, then same-width capture |

## Hot interaction comparisons

Measure on equivalent authenticated QA accounts, data and warm/cold state, from user input to visible usable result; retain raw samples, viewport, build SHA, browser, network and timing definition. Report median and samples for both sides. A measured ours/original ratio over 1.5 is a bug; unavailable is not zero or a pass. Existing Home shell timings in state lack matched original measurements and cannot establish a ratio.

| Interaction                              | Ours                                                    | Original                                                                   | Ratio                                                     |
| ---------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| Open existing project to usable notebook | median 860.22 ms; samples 853.34, 862.29, 860.22 ms     | focusable SQL editor: median 1947.0 ms; samples 12430.8, 1947.0, 1821.6 ms | not comparable: different navigation and project contents |
| Open search and display results          | median 185.18 ms; samples 182.58, 185.18, 283.47 ms     | median 277 ms; samples 1567.8, 277, 270.5 ms                               | not comparable: different result oracle                   |
| Create notebook to usable editor         | median 1998.13 ms; samples 2113.95, 1998.13, 1980.52 ms | median 2871.9 ms; samples 4989.1, 2871.9, 2135.4 ms                        | not comparable: required naming dialog differs            |

Labs measurements used QA9455 at 800 × 513 on served `0577aa86819e5c0fb50c31d441aba18a46c987aa`. Search ends at the exact owned Sales result rather than the original's first editable result. Project open starts from that result rather than Home's Edit button, and uses sample orders rather than the Sales dashboard. Creation includes the required naming dialog, then Query and visible typed `SELECT 1`. These are measured interaction baselines, not matched comparisons or ratio proof. Raw logs: `.tmp/analytics-owner/labs-open-bench.log` and `labs-matched-bench-3.log`; screenshots: `labs-bench-search.png`, `labs-bench-open.png`, `labs-bench-create.png` in the same directory.

Original project open: same QA account, workspace, version, browser, viewport and network as search; warm Edit click on the Sales Revenue demo until SQL is visible, its Monaco editor receives focus, and an ArrowRight key event leaves focus in the editor. This checks focus and key delivery, not editing or query execution. Samples in `.tmp/analytics-owner/original-turn-open-bench.log`; the earlier visible-controls-only samples are in `.tmp/analytics-owner/original-project-bench.log`. No matched Labs measurement or ratio is claimed.

Original creation: same account, workspace, browser, viewport and network; warm Projects list New project click, then Query click, until typed `SELECT 1` is visible in the editor. Samples in `.tmp/analytics-owner/original-turn-create-bench.log`. Three test projects and two exploratory projects were moved to trash and confirmed absent from the active project list; trash retention is 30 days. No query was run and no matched Labs measurement or ratio is claimed.

Original search: QA fleet account in Builder QA, original version 3.0.610, headless Chrome 157, 800 × 513 viewport, existing network; warm `Sales` input to first visible editable result. Raw samples: `.tmp/analytics-owner/original-search-bench.log`. No matched Labs measurement or ratio is claimed.

## Checker contract

The current `e2e/core-flows.ts` catalog contains no Labs/Cut-specific named flow. Keep all eleven named flows and first-run/native subcheck; do not weaken their setup or convert failures to skips. Add the new core flow IDs above to the actual runner and catalog as implemented. `e2e/core-flows.ts` reads these sections, rejects unknown or conflicting named flow classifications, and skips names explicitly classified Labs/Cut. All eleven current names are Core. Screen checkers still need to consume this scope, skip Labs/Cut and mask their intentionally omitted entry regions before calculating visual denominators; unknown items must not silently pass. Screen-checker integration and all five capture pairs are pending.

## Data, schema, CSV and history QA paths (24)

Paths mapped by the 2026-11-20 exploratory pass. Each row is held in place by the named spec; rows marked live were also exercised in the browser, and rows marked open record a known gap rather than a passing check.

| Path                           | What is exercised                                                                             | Held by                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `dc-empty-state-phone`         | Data page with no connections at 390px keeps both cards reachable                             | `data-page.mobile.spec.tsx` (live)                 |
| `dc-draft-name-whitespace`     | Save draft is not offered for a whitespace-only name                                          | `AddDataConnectionForm.draft-name.spec.tsx` (live) |
| `dc-name-too-long`             | Name over the server limit shows a specific message on input and draft                        | `AddDataConnectionForm.validation.spec.tsx`        |
| `dc-delete-escape`             | Delete confirmation takes focus and closes on Escape                                          | `ConnectionRowMenu.escape.spec.tsx` (live)         |
| `dc-copy-id-unavailable`       | Copy ID with no clipboard shows an error instead of throwing                                  | `ConnectionRowMenu.escape.spec.tsx`                |
| `dc-form-phone-resources`      | Setup resource labels stack above content at 390px                                            | `data-resource-row.mobile.spec.tsx` (live)         |
| `dc-bad-service-account-json`  | Invalid service account JSON on Create is only rejected by the server (open)                  | `AddDataConnectionForm.feedback.spec.tsx`          |
| `sb-tab-row-scrollbar`         | Data page tab row has no stray vertical scrollbar                                             | `data-page.mobile.spec.tsx` (live)                 |
| `sb-tree-search-table`         | Sample tree search keeps a schema whose table matches                                         | `sample-catalog.spec.ts` (live)                    |
| `sb-status-select-chevron`     | Schema status select draws one chevron                                                        | `data-page.mobile.spec.tsx` (live)                 |
| `sb-dialog-escape`             | Data browser dialog takes focus on open so Escape closes it                                   | `DataBrowserDialog.mounted.spec.tsx`               |
| `sb-tree-error-copy`           | Tree load failure and Retry come from the catalog                                             | `DataBrowserDialog.mounted.spec.tsx`               |
| `sb-favorites-recents-refresh` | Rapid favorite toggles, recents order and dedupe, repeated refresh, offline expand with Retry | live only                                          |
| `csv-utf8-without-bom`         | UTF-8 CSV without a byte order mark keeps its characters                                      | `import-project-csv.spec.ts`                       |
| `csv-wide-row`                 | A row wider than the header reports that cause                                                | `import-project-csv.spec.ts`                       |
| `csv-empty-and-blank-header`   | Empty file, blank header cell and trailing empty header cells                                 | `import-project-csv.spec.ts`                       |
| `csv-nameless-file`            | A file named only `.csv` is rejected                                                          | `import-project-csv.spec.ts`                       |
| `csv-download-feedback`        | Result download confirms success and reports failure                                          | `CellOutputView.csv.spec.tsx`                      |
| `csv-upload-partial-failure`   | Files list refreshes after a multi-file upload fails part way                                 | `ProjectFilesPanel.spec.tsx`                       |
| `csv-files-panel-status`       | Stale import status clears on rejection; Retry only for list failures                         | `ProjectFilesPanel.feedback.spec.tsx` (live)       |
| `csv-files-panel-copy`         | Files panel copy comes from the catalog                                                       | `ProjectFilesPanel.i18n.spec.tsx`                  |
| `qh-history-count-wording`     | History edit-group counts use singular, plural and truncated wording                          | `ProjectHistoryPanel.spec.tsx` (live)              |
| `qh-sample-sql-terminators`    | Sample SQL accepts repeated semicolons and trailing comments                                  | `sample-query.spec.ts`                             |
| `qh-history-long-version-name` | Long version names wrap inside the History panel at 390px                                     | `ProjectHistoryPanel.spec.tsx`                     |

Open: overlapping Run presses are dropped while the first run is being admitted (deliberate, asserted by `autosave-run.ts`); offline file upload shows progress without an error for over 35 seconds; plain file upload hides the real storage error behind the generic message.

### Collection and sharing paths

`organize-collection-dialog` checks mouse and keyboard opening, Unicode draft, cancel, draft reset and Escape without creating an object. `qa2-share-panel-staged-invites` checks staged selection removal and copy link without sending. `organize-and-share` remains unavailable until isolated collection membership and authorized recipient fixtures support the complete create, add/remove, grant, published-recipient, reload and failure paths. Additional combinations to cover include empty and long input, rapid repeats, back/forward, refresh during mutations, interleaved changes, narrow windows, offline and failed requests.

### Reading a published dashboard's data in a check

A check that needs every SQL panel's rows from a current release reads them through a private app session: `open-published-app-session`, `get-published-app-session` until `runningCellIds` is empty, then each cell's saved result with `get-notebook-result-page` (50 rows per page, `sessionId` set, paged until a short or `out_of_range` page). A `truncated`, `sampled` or `coverage_unverified` result is incomplete, never a match. `run-published-project-cell` answers 409 `app_session_required` for every current release (`actions/run-published-project-cell.spec.ts` asserts it), so a check built on it reads zero panels. Values are compared only between two reads of the same source taken close together; a source panel that disagrees with itself across identical uncached reads (an un-tiebroken ranking or an approximate aggregate) is nondeterministic and cannot be the oracle.
