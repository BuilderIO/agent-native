# Delegated companion validation

The companion is rebased at `f109d444be319cb58df592d4442cac0f3b68fd49`
on frozen parent `8b7b62780d95defdf765f8963d64260a0e932b65`, which includes
fetched main `ce19f80f156f1903c12c4a7820bdb9e82dba1f69`. The authorized local
rebase had no conflicts; range-diff preserves the companion patch. The only
inherited change in its modified source files is main's turn-aware agent-chat
tracking. CLI/embed behavior, Mail catalogs, Dispatch registration, and Design
instructions remain outside this companion.

Fresh evidence is indexed in `.tmp/companion-validation-rebased.md`. Earlier
round1/round2 results and failing-first proofs remain historical evidence;
the old seventeen-template report must not certify the rebased artifact.
The current harness labels its own pre/post captures explicitly and records
actual app-entry identity. The final registry report compares a separately
executed capture of the exact pinned main above with thirty-two preserved
companion records and two refreshed Factory records. A current pre-filter
registry is never treated as a main execution. Main's Design export addition
from #8086 is inherited, not a companion change. Later Factory setting changes
require their own affected-owner checks; this capture does not certify action
body behavior.

## The twelve initial focused-batch failures

All six service assertions retain their exact original expected values. Their
fixtures now identify the intended in-app caller explicitly. Unknown provenance
intentionally counts as outside; it cannot stand in for a frontend interaction.
The four audit cases retain the exact null approval and lease/run identifiers;
they now also require tool caller semantics and outside network provenance.

| File and test                                                                                         | Old → new expectation or fixture                                                                                                                                                                                    | Why the old expectation or fixture is wrong                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automations/service.spec.ts`: does not report a change another writer already applied                | Actor omits caller → `caller: "frontend"`; `changed === false` remains exact.                                                                                                                                       | An unknown outside caller taking management adds `mcpManaged`, which is a real change even if another writer already applied the body.                                                                                                                           |
| `automations/service.spec.ts`: lifts the pause but keeps an active run marker on update               | Actor omits caller → `caller: "frontend"`; enabled, running status, error, and cleared pause assertions remain exact.                                                                                               | Outside takeover of a running unmarked automation is intentionally refused; this fixture exercises an ordinary frontend edit.                                                                                                                                    |
| `automations/service.spec.ts`: does not attribute a concurrent pause to a no-op update                | Actor omits caller → `caller: "frontend"`; `changed === false` and disabled state remain exact.                                                                                                                     | Outside takeover would add a provenance marker, so it would no longer be a no-op.                                                                                                                                                                                |
| `automations/service.spec.ts`: rejects the retry when the automation is no longer an automation       | Actor omits caller → `caller: "frontend"`; exact 400 and one attempted write remain.                                                                                                                                | The retry fixture concerns an in-app edit, not outside takeover; earlier failing tests also left one-shot resource reads queued, causing cascading results.                                                                                                      |
| `automations/service.spec.ts`: denies the retry when the automation no longer belongs to the app      | Actor omits caller → `caller: "frontend"`; exact 403 and one attempted write remain.                                                                                                                                | This is the ordinary edit access-revalidation case; the previous failed test's unconsumed read was not evidence of a changed access contract.                                                                                                                    |
| `automations/service.spec.ts`: rejects with a conflict when the automation keeps changing             | Actor omits caller → `caller: "frontend"`; exact 409 and no unconditional write remain.                                                                                                                             | The fixture must exercise ordinary edit retry exhaustion; cascading leftover reads previously reached another refusal first.                                                                                                                                     |
| `audit/attribution.spec.ts`: does not reach a child given a copy of the approved action's context     | Original lease expectation `networkProtocol: null, networkId: null` → `"a2a", TASK`; reviewed caller reversal `"a2a"` → exact `"tool"`.                                                                             | The child receives no approval override. Network provenance carries outside policy; changing the caller breaks ordinary app tool behavior.                                                                                                                       |
| `audit/attribution.spec.ts`: does not outlive the approved invocation for a context kept after it     | Original lease expectation `networkProtocol: null, networkId: null` → `"a2a", TASK`; reviewed caller reversal `"a2a"` → exact `"tool"`.                                                                             | Approval expiry removes the one-call grant, not outside network provenance or tool semantics.                                                                                                                                                                    |
| `audit/attribution.spec.ts`: does not reach a defineAction child a raw entry's code bridge runs       | Original lease expectation `networkProtocol: null, networkId: null` → `"a2a", TASK`; reviewed caller reversal `"a2a"` → exact `"tool"`.                                                                             | The bridge preserves the network origin while withholding the parent's approval from the child.                                                                                                                                                                  |
| `audit/attribution.spec.ts`: does not reach a raw child a raw entry's code bridge runs                | Original lease expectation `networkProtocol: null, networkId: null` → `"a2a", TASK`; reviewed caller reversal `"a2a"` → exact `"tool"`.                                                                             | Raw child execution has the same provenance and approval isolation contract.                                                                                                                                                                                     |
| `agent-chat/action-filters-a2a.spec.ts`: approved replay context                                      | `caller: "a2a"` → `caller: "tool"`; exact `networkProtocol: "a2a"`, `networkId: "task-1"`, lease thread/turn and argument-bound grant retained; add `isOutsideAgentCall(ctx) === true`.                             | Root reversed caller relabeling: the replay is an app tool invocation with outside provenance, not a direct A2A action.                                                                                                                                          |
| `agent-chat-plugin.surface.spec.ts`: keep template actions native so a sibling never has to shell out | Source slices containing `...templateScripts`, `basePrompt +`, and no dev prompt → real-plugin behavioral replacement in `agent-chat-plugin.additional-actions.spec.ts`, both dev and production, both A2A and MCP. | The registry now passes through `preferMcpAppActions`; declaration spelling cannot prove behavior. The replacement requires the app entry, first-request native schema, exact native widget prompt, and absence of CLI action guidance with `leanPrompt: false`. |
| `agent-chat-plugin.a2a.spec.ts`: keeps framework automation tools on the delegated first request      | Two source occurrences of `...automationTools` → actual A2A registry, first-request tools, and available tools contain `manage-automations`, in dev and production.                                                 | Source spread counts cannot prove the merged/filter result. The replacement boots the actual plugin with the automation group enabled; the existing exact tool-surface unit assertions remain.                                                                   |

## Additional fixture repairs

- The real approval-route test initializes the real org and run-store release
  migrations instead of guessing org columns or omitting execution leases. Its
  exact owner, org, input, call ID, argument hash, pending state, no-definition
  preapproval, one marked replay, and duplicate-409 assertions remain.
- Collision runs use distinct dev and production task IDs. Reusing a completed
  run's identity prevented the production loop from acquiring an execution
  lease; that was a fixture lifecycle error, not an action-registry failure.
- Collision failure diagnostics include the full bounded replay result. No
  success or refusal assertion is relaxed.
- The isolated audit report generator verifies all seventeen exit-zero,
  three-pass results before writing. It no longer checks for a final marker the
  runner writes only after report generation.

## Failing-first collision proof

Only `.tmp/delegated-app-collision/precedence-fix.patch` was reversed, preserving
the runtime filter, provenance changes, and every other companion edit. The
additional-actions spec failed exactly four cases: dev/production lost the
app-owned `set-search-params`, and approval replay returned
`Unknown or unavailable tool: set-search-params`. Restoring the precise patch
made the same eighteen tests pass. The later behavioral replacements add four
cases without replacing those collision positive/negative controls.

The model choosing to ask in prose before making a tool call remains the
separate `#8016` follow-up; this validation exercises the actual tool call and
its durable approval lifecycle.

## P2/P3 repairs and validation contracts

- Both delegated loops explicitly use `actionCaller: "tool"`; replay uses
  `caller: "tool"`. Network protocol/id and the single-invocation audit override
  remain intact. App-owned approval predicates still decide ordinary actions.
- The routed automation matrix requires an actual approval event when A2A
  exposes `manage-automations`. Inline MCP separately asserts that it is absent;
  an unavailable result is never counted as approval.
- A real-plugin app approval probe records caller, network protocol/id and
  `isOutsideAgentCall`. Delegated tool calls must classify outside, while the
  in-app tool control must execute without outside approval.
- Delegated registries re-add only the resolved, read-only `skillReadScripts`
  entry after runtime filtering and before tool-search attaches. Direct MCP
  eligibility and allowlists are unchanged. Resource and source readers remain
  excluded, including `framework-search`, `source-search`, and `manage-jobs`.
- Prompt projection suppresses framework-generated resource lookup hints,
  resource indexes, and available-app guidance. Required instruction bodies are
  included eagerly when no runtime reader can retrieve them. User-authored
  instruction bodies remain data and are not rewritten by substring matching.
  The shared framework builder has an explicit delegated option; the default
  in-app prompt strings keep their existing construction. Delegated prompts
  omit the generic corpus/runtime instructions, and schema context is rendered
  with raw database tools off so it cannot advertise unavailable SQL tools.

### Static reader trust trace

`createDocsScriptEntries()` resolves the read-only docs-search wrapper to
`scripts/docs/search.ts`. `loadAllDocs()` combines only `loadFilesystemDocs()`
and `loadAgentBundleDocs()`. The first reads the installed package's fixed
`docs/{AGENTS.md,SKILL.md,README.md}` and top-level Markdown/MDX `docs/content`
pages. Query and slug arguments never become filesystem paths.

`loadAgentBundleDocs()` reads the build-time virtual agent bundle and runtime
skills from `getRuntimeSkillsForUser()`. If that virtual module is unavailable,
`loadAgentsBundle()` resolves the app configuration and calls
`readAgentsBundleFromFs()` on the app root and installed workspace-core sources.
That fallback reads configured app instruction files (app-root realpath
containment), `.agents/skills` / legacy `.agent/skills`, and installed
workspace-core instructions/skills. Skill reference files are preloaded from
these authored directories with extension and byte limits. Host configuration
and authored skill symlinks are trusted code inputs, not request-controlled
paths. The fallback does not enumerate memory, resource, or workspace-file
directories. It does not read SQL resource bodies. User Labs state only filters
visibility of bundle skills; it supplies no documentation content.

The docs-search owner spec uses real filesystem-bundle loading with positive
app-instruction and codebase-skill controls, then attempts private memory,
resource, workspace-file and non-codebase skill slugs, absolute paths and
traversal. A plugin-boundary control stores personal, shared and workspace SQL
resources and attempts to retrieve their bodies with the preserved reader.
Existing Labs visibility controls remain. Both owner suites passed under the
round2 artifact, including their real filesystem and SQL-resource controls.

### Caller-policy inventory (read-only)

The inventory covers template actions and supporting caller classifiers, plus
Dispatch package/template actions. It does not patch templates. A raw caller
check is not protocol-aware. A branch that deliberately formats direct MCP
results is listed separately from an outside-approval policy; it should not be
mechanically converted to `isOutsideAgentCall`.

| Action / location                                                                                       | Behavior and tool+protocol consequence                                                                                                                             | Protocol-aware? |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Design `read-composer-source`, `templates/design/actions/read-composer-source.ts:68`                    | A2A-only guard refuses a Slides peer read. Tool+A2A does not hit it; candidate for the separate outside-policy helper sweep.                                       | No              |
| Slides `read-composer-source`, `templates/slides/actions/read-composer-source.ts:66`                    | A2A-only peer-source recursion guard; same follow-up.                                                                                                              | No              |
| Slides 2 `read-composer-source`, `templates/slides-2/actions/read-composer-source.ts:71`                | A2A-only peer-source recursion guard; same follow-up.                                                                                                              | No              |
| Content `create-content-database`, `templates/content/actions/create-content-database.ts:167`           | Requires direct-MCP agent schema. Tool calls keep main's existing schema behavior; review whether a broader outside contract is intended.                          | No              |
| Content `add-database-item`, `templates/content/actions/add-database-item.ts:72`                        | Direct-MCP agent argument schema.                                                                                                                                  | No              |
| Content `update-database-item`, `templates/content/actions/update-database-item.ts:75`                  | Direct-MCP agent argument schema.                                                                                                                                  | No              |
| Content `patch-database-items`, `templates/content/actions/patch-database-items.ts:82`                  | Direct-MCP agent argument schema.                                                                                                                                  | No              |
| Content `upsert-database-item-by-key`, `templates/content/actions/upsert-database-item-by-key.ts:60`    | Direct-MCP agent argument schema.                                                                                                                                  | No              |
| Content `configure-document-property`, `templates/content/actions/configure-document-property.ts:152`   | Direct-MCP setup schema; tool calls retain main's behavior.                                                                                                        | No              |
| Content `update-content-database-view`, `templates/content/actions/update-content-database-view.ts:172` | Direct-MCP setup schema.                                                                                                                                           | No              |
| Content `restore-content-database`, `templates/content/actions/restore-content-database.ts:80`          | Direct-MCP lifecycle schema.                                                                                                                                       | No              |
| Content `get-content-database-source`, `templates/content/actions/get-content-database-source.ts:53,88` | Direct-MCP status schema and bounded status response.                                                                                                              | No              |
| Assets `open-asset-picker`, `templates/assets/actions/open-asset-picker.ts:175`                         | Skips browser navigation command only for direct MCP. Tool calls preserve existing navigation behavior; decide separately if outside transport should suppress it. | No              |

The following are caller semantics/formatting rather than outside-only gates:

| Action / location                                                                                                                                                                                                                                                                                                                                                     | Behavior retained by `caller: "tool"`                                                                                                | Protocol-aware?                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Design mutation version helper, `templates/design/server/lib/design-versions.ts:438`                                                                                                                                                                                                                                                                                  | Tool-only restorepoint/chat context; relabeling lost it.                                                                             | No; intentional tool semantics                     |
| Design reprompt helper, `templates/design/server/lib/reprompt-action-guard.ts:79`                                                                                                                                                                                                                                                                                     | Tool/thread reprompt guard.                                                                                                          | No; intentional tool semantics                     |
| Clips `request-transcript`, `templates/clips/actions/request-transcript.ts:1040`                                                                                                                                                                                                                                                                                      | Tool/frontend calls validate media and use the pending transcript queue path.                                                        | No; intentional tool semantics                     |
| Mail `get-email`, `templates/mail/actions/get-email.ts:56,84`                                                                                                                                                                                                                                                                                                         | Direct MCP gets account/read-only envelope; tools get the normal email object.                                                       | No; direct-MCP formatting                          |
| Mail `get-thread`, `templates/mail/actions/get-thread.ts:90,147`                                                                                                                                                                                                                                                                                                      | Direct-MCP thread/read-only envelope.                                                                                                | No; direct-MCP formatting                          |
| Mail `list-emails`, `templates/mail/actions/list-emails.ts:357`                                                                                                                                                                                                                                                                                                       | Direct MCP defaults to inventory format when format is omitted.                                                                      | No; direct-MCP formatting                          |
| Calendar `list-events`, `templates/calendar/actions/list-events.ts:885`                                                                                                                                                                                                                                                                                               | Direct MCP defaults to inventory output; tool calls keep normal default output.                                                      | No; direct-MCP formatting                          |
| Design `export-png`, `templates/design/actions/export-png.ts:142,159`; screenshot helper `templates/design/actions/take-design-screenshot.ts:660`                                                                                                                                                                                                                     | Direct-MCP PNG attachment extraction/cache.                                                                                          | No; direct-MCP formatting                          |
| Content `list-trashed-content-databases`, `templates/content/actions/list-trashed-content-databases.ts:23`                                                                                                                                                                                                                                                            | Direct-MCP default limit of 100.                                                                                                     | No; direct-MCP default                             |
| Content `edit-document`, `templates/content/actions/edit-document.ts:269,307`; `suggest-document-edit`, `templates/content/actions/suggest-document-edit.ts:200`; `update-document`, `templates/content/actions/update-document.ts:791,822`                                                                                                                           | Agent revision/idempotency and bounded-response rules already include tool.                                                          | No; tool is explicitly included                    |
| Content `add-comment`, `templates/content/actions/add-comment.ts:238`; lifecycle helper `templates/content/actions/_document-lifecycle.ts:44`; history helper `templates/content/server/lib/document-history.ts:71`; import helper `templates/content/server/lib/content-import.ts:552`; version helper `templates/content/server/lib/document-version-context.ts:33` | Agent attribution/history/lifecycle paths already include tool.                                                                      | No; tool is explicitly included                    |
| Content comment source helper, `templates/content/server/lib/comment-submission-source.ts:5`                                                                                                                                                                                                                                                                          | Tool maps to agent attribution; MCP/WebMCP map to MCP attribution.                                                                   | No; attribution semantics                          |
| Slides / Slides 2 `patch-deck`, `templates/slides/actions/patch-deck.ts:1304`, `templates/slides-2/actions/patch-deck.ts:1467`; version helpers `templates/slides/server/lib/deck-versions.ts:42`, `templates/slides-2/server/lib/deck-versions.ts:42`                                                                                                                | Agent patch/version behavior already includes tool.                                                                                  | No; tool is explicitly included                    |
| Plan `get-visual-plan`, `templates/plan/actions/get-visual-plan.ts:73`; `patch-visual-plan-source`, `templates/plan/actions/patch-visual-plan-source.ts:289`; `update-visual-plan`, `templates/plan/actions/update-visual-plan.ts:641`                                                                                                                                | Bounded agent reads and agent edit/review behavior already include tool.                                                             | No; tool is explicitly included                    |
| Clips `get-recording-player-data`, `templates/clips/actions/get-recording-player-data.ts:326`; access helper `templates/clips/server/lib/agent-recording-access.ts:11`                                                                                                                                                                                                | Bounded agent transcript/access paths already include tool.                                                                          | No; tool is explicitly included                    |
| CRM classifier, `templates/crm/actions/_crm-action-utils.ts:34`                                                                                                                                                                                                                                                                                                       | Tool/MCP/A2A/WebMCP all classify as agent for CRM write policy.                                                                      | No; tool is explicitly included                    |
| Factory `create-factory`, `templates/factory/actions/create-factory.ts:74`; `create-factory-automation`, `templates/factory/actions/create-factory-automation.ts:176`                                                                                                                                                                                                 | Agent navigation branches already include tool; the equivalent automation writer's outside approval is owned by the separate repair. | No for navigation; approval uses the shared helper |

No template or Dispatch `needsApproval` predicate was found that decides outside
policy using a raw `caller === "mcp"` / `"a2a"` check. Mail's send/schedule/queued
send actions delegate to `templates/mail/server/lib/automation-settings.ts`:
`requiresEmailSendApproval` exempts only an explicitly authorized automation;
all ordinary tool and direct network callers require approval. CRM
`merge-crm-records.ts:101` uses its agent-inclusive classifier;
`update-crm-record.ts:82,213` decides from the requested fields. Provider API
approval remains owned by each action's existing predicate.

Dispatch has no raw MCP/A2A caller-policy branch in package or template actions.
Its sensitive actions use unconditional `needsApproval: true`:
`packages/dispatch/src/actions/approve-vault-request.ts:19`,
`create-link-token.ts:14`, `create-vault-grant.ts:17`,
`create-vault-secret.ts:32`,
`grant-vault-secrets-to-app.ts:22`, `revoke-vault-grant.ts:13`,
`set-mcp-app-access.ts:25`, `set-vault-access-settings.ts:18`,
`update-vault-secret.ts:57`; and
`templates/dispatch/actions/apply-workspace-connection-setup.ts:123`,
`set-workspace-connection-grant.ts:78`,
`upsert-workspace-connection.ts:214`.
`packages/dispatch/src/actions/list-workspace-apps.ts:26` uses caller only in an
in-flight request cache key, not as authorization or approval policy.

## Round2 owner-batch fixture repairs

The first round2 owner batch ran 553 tests: 541 passed and twelve failed.
Each failed test is accounted below. No assertion was deleted or relaxed.
Exact routed A2A approval and every positive/negative control remain mandatory.

| File / test                                                                                                                                                | Exact old → new                                                                                                                                                                   | Why the old fixture or expectation is wrong                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-chat-plugin.delegated-runtime.spec.ts`: production / mounted default / contains ask_app and ask-agent through the configured MCP mount              | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: production / compact / contains ask_app and ask-agent through the configured MCP mount                      | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: production / connector / contains ask_app and ask-agent through the configured MCP mount                    | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: production / full token / contains ask_app and ask-agent through the configured MCP mount                   | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: production / full env / contains ask_app and ask-agent through the configured MCP mount                     | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / mounted default / contains ask_app and ask-agent through the configured MCP mount                     | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / compact / contains ask_app and ask-agent through the configured MCP mount                             | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / connector / contains ask_app and ask-agent through the configured MCP mount                           | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / full token / contains ask_app and ask-agent through the configured MCP mount                          | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / full env / contains ask_app and ask-agent through the configured MCP mount                            | Inline result `Unknown or unavailable tool: manage-automations` → `Error: Unknown tool "manage-automations"`; exact unavailable/approval-false/no-definition assertions retained. | The real loop's absent-tool contract uses this exact error; inline MCP absence is intentional and does not count as approval.                                                                       |
| `agent-chat-plugin.delegated-runtime.spec.ts`: dev / keeps an in-app tool caller outside the outside-call approval policy                                  | This test's `inAppRun()` → `inAppRun(true)` to opt into `nativeActionsInDev`; exact available/approval-false/result/caller/no-protocol assertions unchanged.                      | Default dev chat intentionally exposes template actions through its CLI. The native probe must be registered to test its approval predicate; sibling default-dev tests retain their original setup. |
| `agent-chat/action-filters-a2a.spec.ts`: runs the approved call once, under its lease rather than the paused task's journal, and links its row to the task | Audit row `caller: "a2a"` → `caller: "tool"`; exact protocol/task/lease/grant fields retained.                                                                                    | Root restored tool semantics in replay; outside identity remains in `networkProtocol: "a2a"`. The already-correct replay-context assertion is unchanged.                                            |

## App docs-search collision

A bounded real-plugin fixture fails in all four dev/production × lazy/full cases
before the repair: the post-filter static spread overwrites the exact app action.
The repair installs the known static reader as a fallback before the filtered
app/scoped registry. Prompt loading receives `skillReadTool: "docs-search"` only
when the surviving entry is that known static reader by identity, otherwise
`null` selects the existing eager skill loading. A2A delays only resources and
system-prompt concatenation until the final map exists, then assigns the run
context prompt before the loop. Scoped actions still resolve once per run.
The fixture requires exact app-entry identity, its own callable result, two
resolutions across two protocols, and `null` for both prompt loads. The static
reader positive controls and the eager-content owner test remain. Direct MCP
policy, catalogs, and aliases are unchanged. The restored full owner batch
(additional-actions, replay, prompt-resources.jev) passes all 133 tests, including
all four collision cases; the runtime owner matrix passes all 106 tests.

## Outside-approval policy scope

Outside-delete approval is approved policy assigned to a separate helper/policy
migration. This companion preserves action-owned approval predicates and adds no
new global deletion gate. The review's concrete migration findings are retained
only in the private handoff, without identifying ungated operations here.
Caller labels remain tool semantics; network protocol carries outside origin.
The byte-identical shared helper and its comments are outside this repair slot.

## Type-only Factory forwarding boundary

The nested core action requires `ActionRunContext` in its public type while the
Factory wrapper receives a partial context. The boundary assertion preserves
the entire forwarded object after the existing membership/target checks;
it supplies no caller default and performs no runtime validation. Missing origin
stays missing, so this assertion is a typing limitation rather than a grant of
caller authority. Existing outside-origin and chaining controls remain required.

## Rebased Factory fixture bootstrap

The first rebased parallel run had two first-case 30-second timeouts while the
real Core schema snapshot initialized. Their unfinished work reached the next
case and doubled its mock counts. The worker-one diagnostic retained one such
pair of failures. Both failed logs remain; none is counted as a pass.

| File / test                                                                                                                                 | Exact old → new fixture                                                                                                                                                                                   | Reason and unchanged contract                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/factory/actions/create-factory-automation.spec.ts`: pauses a tool over mcp before creation and binds approval to exact input     | Action import and real store bootstrap inside the first test → awaited action import and `withMigrationRuntime(() => settingsStore.ready())` in `beforeAll` with a 120-second cold-bootstrap hook budget. | The fixture must finish real database initialization before testing approval behavior. Each test keeps its existing 30-second budget and exact pause/input/no-effect/approved-once/origin assertions. |
| Same file: pauses a tool over a2a before creation and binds approval to exact input                                                         | An earlier timed-out bootstrap could outlive its case → the shared `beforeAll` completes before either protocol case starts.                                                                              | Prevents a prior test's unfinished invocation from contaminating the exact one-effect assertion; no mock-only cleanup or assertion relaxation.                                                        |
| `templates/factory/actions/run-factory-automation.spec.ts`: requires exact approval for tool over mcp and queues the selected peer job once | First-use action import/store bootstrap → the same existing real readiness helper and awaited module import in `beforeAll`.                                                                               | This owner also hit the same initial cold-bootstrap boundary. Its exact target, argument-bound approval and one-queue checks remain.                                                                  |
| Same file: requires exact approval for tool over a2a and queues the selected peer job once                                                  | An outstanding prior timed-out invocation → fully awaited common setup before protocol cases.                                                                                                             | Exact member/selected-definition/workflow/chaining/ordinary-call controls and every assertion remain.                                                                                                 |

No production helper, export, gate/store mock, arbitrary sleep, skipped case,
case reorder, or mutation-latency allowance was added. Only the cold-bootstrap
hook has a larger budget; action behavior remains under the normal test budget.

## Current review status

The fresh review identified two Factory approval/provenance gaps. The focused
review of their first repair confirmed the argument-bound action gates and
server-context propagation, and requested further Factory settings hardening.
The earlier encoded-settings snapshot passed 194 tests but was superseded by
the caller-only refusal ruling. The final refusal delta passes all 308 tests
across eight Factory suites, Factory typecheck, focused lint/format,
localization/source-reading guards, LF and diff checks. Its corrected
failing-first run reproduced 105 intended failures with 150 controls passing.
The initial proof's five incorrect error-type expectations and both earlier
logs remain retained separately; they are not counted as final evidence.

The required saved-metadata control passed before production changes.
Operational and condition metadata retain their existing physical
representation, and prompt bodies remain supported. A read-only inventory of
45 written header keys established no legitimate multiline caller setting.
Ordinary settings preserve main's bytes, including last-field header spacing.
Generic setter no-op and lenient preview behavior remain compatible; strict
normalization belongs to write candidates. The existing creation stamping
call-site in `factory-scheduler-job.ts` uses that same strict boundary without
changing authority, conditional insert or retries. A new independent delta
review confirmed the marker, byte-compatibility, metadata, preview and CAS
behavior. It requested a typed validation response for refused caller settings
and removal of an extra public sentence. The three-file typed-error delta
passes 219 tests across four affected suites after reproducing 86 intended
failures with 79 controls passing. Factory typecheck, focused lint/format and
the relevant guards pass; lint now has explicit exit-status evidence. Refusal
uses the framework's real `fail` contract with status 400, `invalid_request`
and the affected field. No serialization or approval behavior changed. The
final focused review approved that exact typed-error delta and corrected
claims with no P1/P2 findings. Earlier focused review held the marker,
byte-compatibility, saved-metadata, preview and CAS behavior; the approval is
bounded to those covered paths and the final typed-response change.

Task-added encoded-value success cases now assert caller-only refusal under the
updated product rule. Existing approval/no-effect/input-binding, saved
metadata/body, authoritative-row/CAS and predecessor-history assertions remain.
The marked CRLF save/restore/preview/restore sequence exercises the real action
and history boundaries. The exact final delta, policy ledger and commands are
indexed by `.tmp/factory-single-line-refusal/manifest.json`.

The new regressions produced sixteen intended failures and forty-seven passes
on unchanged production. At the first-repair snapshot, all sixty-three owner tests,
twenty-three create/run tests and fifty-one unchanged-classifier controls pass.
Factory typecheck, focused formatting/lint, localization and source-reading
guards, LF and diff checks pass. The exact source/test delta and evidence are
recorded in `.tmp/factory-two-p1/manifest.json`. The earlier failures and code
snapshots remain retained; they are not counted as passing evidence.

| Owner fixture            | Old → new                                                                                                                            | Reason and unchanged contract                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save action spec         | Identity `defineAction` mock → actual framework `defineAction` through `importOriginal`, retaining the existing failure leaf.        | Approval tests now exercise real argument binding and dispatch. Every existing assertion remains.                                                                             |
| Save action spec         | No shared bootstrap → real action import and `settingsStore.ready()` inside `withMigrationRuntime` in a 120-second `beforeAll` hook. | Cold initialization finishes before the unchanged 30-second action cases; no mocked gate/store or sleep.                                                                      |
| History helper spec      | Omitted context → explicit frontend context for ordinary in-app fixtures.                                                            | The internal helper receives server context; a missing context remains outside under the unchanged classifier. Existing authoritative-row and trigger-type assertions remain. |
| History helper spec      | No delete/returning leaf → a database leaf that records orphan-history cleanup on CAS failure and write errors.                      | Observes the existing cleanup contract without replacing it or weakening its assertions.                                                                                      |
| History resource fixture | Widened `createdBy` string → literal `"system" as const`.                                                                            | Matches the existing resource type; no runtime or expected-value change.                                                                                                      |

The new restore action owner uses real framework dispatch and the actual history
helper, with scoped lookup and persistence leaves observed. It covers approval
before history/resource effects, changed-input rejection, one approved effect,
outside marking and ordinary unmarked behavior. The eight-case matrix in the
history helper spec covers retained current provenance.
The internal helper accepts `ActionRunContext | undefined`; the original value
is forwarded without a default caller or relabel.

## Coverage boundary

Outside approval and creation/edit marking cover the framework automation
management actions, Factory's prompt-automation create/save/restore/run actions,
and Analytics' index scheduler. Marked prompt runs require approval for each
prepared write. Other persistence paths and a store-level guarantee that every
write preserves and stamps outside provenance are separate follow-up work.
This companion makes no universal write-path guarantee.

The complete broader writer inventories are private follow-up material and are
not published here. CLI, embed, ACL and authentication behavior remain unchanged.
Final targeted staged guards pass against the frozen parent with no skips:
MCP call boundary, shrinking legacy hints, localization catalogs/changed copy,
and source-reading tests. The exact-main registry comparison is complete within
its stated capture limits. Historical broad checks, subsequent affected-owner
checks and focused review approvals remain separate evidence epochs; no full
repository or deployed-provider validation is claimed for the final delta.
