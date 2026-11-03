# Resource text ranges implementation

**Status:** Completed. Range implementation and tests live in the existing Resource reader and its spec. PR preparation includes the authorized main update and passing local guard, affected-Core and mutation checks. Public MDX remains unchanged.

**Architecture:** [Text ranges for the resources action](../resource-text-ranges-architecture.md).

**Original baseline:** `70b1b9f641e9e1c7178fa7f52a454105add01481`, Core `0.222.2`.

**PR verification base:** `ee6264cf4443bdca6f8847b65cbf23d2bdaefce2`, updated with the user's approval on November 2, 2026.

## Problem / Goal

The built-in `resources` action returns complete stored text. Long results can be cut by the existing runner without a dependable Resource continuation offset.

Add paired `offset` and `limit` controls to its read operation. Known inline text returns selected text and a short continuation footer inside the existing result allowance. Other stored representations return whole without a footer. Ordinary reads preserve their output.

## Solution

Keep the production change in two files:

1. `packages/core/src/server/agent-chat/script-entries.ts`: action schema, existing framework admission, range dispatch and resolved allowance.
2. `packages/core/src/scripts/resources/read.ts`: checked Resource resolution, typed range inputs, UTF-16 selection, representation dispatch, counts, footer and exact fitting, while preserving CLI behavior.

The architecture contains the complete request/result contract and exact file map. Read it in full. It is selected design, not permission to widen the scope.

### Explore findings and decisions

- The native runner coerces raw-schema arguments and strips invalid optional placeholders. The latest review explicitly retains that behavior and removes this branch's strict-input override. Keep normalized range checks in the handler, including direct calls. Earlier execution records describe the superseded strict-input design, not an instruction to restore it.
- `requireSkillLabAccess()` currently classifies the requested path. Native local aliases resolve to a canonical `skills/` path. Classify using the resolved path so the existing complete-manifest restriction applies to those aliases too. This repairs the existing access rule within the resolver extraction.
- Preserve read-only deduplication. Identical native calls may reuse/suppress results. Document current-content semantics for executed reads, without claiming every repeated call is fresh.
- Terminal output can be shorter than a smaller partial output. Check the complete terminal candidate before searching the monotonic partial-candidate space.
- The actual action and native executor must be exercised. Existing script-entry tests only inspect metadata and classification.
- Keep footer/descriptions/typed diagnostics as stable English agent-protocol text, matching existing tool output. The user removed public documentation changes from scope. All reference and locale MDX files match the baseline.
- New untracked source files are invisible to diff-scoped guards. Use worktree-local `git add -N` for the exact task-owned new files before those checks. This stages no file contents and makes no commit.
- Dependencies have been installed locally using `corepack pnpm install --frozen-lockfile --ignore-scripts`. Vitest, TypeScript, oxfmt and tsx resolve. Workspace `dist` prerequisites may still need the documented prebuild. No parent dependency directories may be borrowed or modified.

## Implementation Plan

### 1. Establish execution state

The coordinator follows the already-read Adviser `execute-plan` guidance and shared `documentation/references/plans-and-epics.md`. Move this selected plan to `docs/plans/in-progress/resource-text-ranges-implementation-2026-10-30.md` before delegating implementation. That exact current path governs all delegates. Keep the architecture at its requested path.

Use `openai/gpt-6-astra#high` for implementers and the independent verifier. The coordinator owns plan/architecture edits and decisions. Delegates own only their assigned file sets. Follow the plan in order and do not edit source while verification is running.

<implementation_tranche id="resource-range-runtime" agent="general">

### 2. Implement the action and behavioral proof

**Mandatory skills**, read in full from `.agents/skills/<name>/SKILL.md`, plus scenario-matching required references:

- `concurrent-agents`: preserve worktree ownership and re-read before edits.
- `agent-native-docs`: use this checkout's actual framework interfaces and docs.
- `adding-a-feature`: assess the four areas without inventing UI or application state.
- `actions`: preserve the existing ActionEntry contract and typed failures. Read `references/action-fields.md` for the applicable field semantics.
- `writing-agent-instructions`: concise, accurate tool parameter descriptions.
- `security`: preserve resolution and complete-content access checks.
- `performance`: bound additional allocations and avoid requested-limit-sized loops.
- `adding-tests-and-ci` and `test-audit`: behavioral ownership, independent oracle, existing CI lanes, no source-string tests or test-only production seams.
- `internationalization`: respect the protocol-text/public-document classification above.
- `verifying-changes` and `reporting-progress`: actual proof and informative progress.

Read root `AGENTS.md`, this plan and the architecture in full. Source changes are limited to the three production files above. Tests belong in:

- `packages/core/src/resources/text-range.spec.ts` (new)
- `packages/core/src/scripts/resources/read.spec.ts`
- `packages/core/src/server/agent-chat/script-entries.spec.ts`
- `packages/core/src/agent/production-agent-single-tool.spec.ts`

1. Revalidate Git state and test isolation. Do not use an externally configured database for tests. Establish the focused existing baseline before edits. If ignored lifecycle scripts prevent tests/typechecking, run the documented worktree-local dependency prebuild, inspect generated changes, and report any unrelated failure rather than changing packages or the lockfile.
2. Extract `resolveResourceForRead(path, scope)` returning checked `Resource | null`. Preserve authenticated/ambient identity, defaults, scope precedence and complete-manifest Lab errors. Canonicalize classification from the resolved Resource's path, not arbitrary user metadata. CLI help, messages, stdout and missing behavior stay in its adapter. A missing ranged Resource becomes a typed failure, not captured diagnostic text.
3. Add the internal formatter/validator. Enforce paired numeric safe integers, offset >= 0 and limit > 0, read-only use, the approved UTF-16/surrogate convention, unchanged substrings and native text classification. Use existing `fail()`/`ActionContractError` for failures. No full-document array or allocation proportional to an oversized requested limit. The latest review tranche below supersedes earlier code-point and unsupported-representation decisions.
4. Fit body, separating newlines and exact footer together under the supplied UTF-16 allowance. Check an EOF candidate first, then find the largest fitting partial prefix. Count actual delivery and calculate its next offset. Preserve lone surrogates and never split valid surrogate pairs. Fail instead of returning a zero-progress page when text remains. Empty terminal responses must also fit. Accept limits up to `Number.MAX_SAFE_INTEGER` without overflowing offset+limit arithmetic.
5. Add action fields/descriptions and direct range dispatch. Pass `context.maxResultChars` or the existing default when absent. Preserve the framework's existing schema validation and input normalization. Keep the declared numeric schema and range checks without a Resource-specific admission override. Preserve Plan-mode classification, approvals, dedupe, other action dispatch and plain legacy reads. Numeric controls must not pass through CLI serialization.
6. Extend the distinct test owners below. Demonstrate relevant new cases failing before their implementation where practical. Use an independent small brute-force oracle for maximal fit. Avoid duplicating whole scenario suites across layers.
7. Format only owned changed files. Report exact checks, failures, decisions, generated prerequisites and the final diff to the coordinator. Do not edit docs/plan/release files owned by the next tranche/coordinator.

<implementation_verification>

**Owner-boundary cases**

- Formatter: astral pairs, isolated surrogates, combining marks, joined emoji, CRLF, whitespace, frontmatter, JSON-like text and footer-like content. Offset middle/EOF/past EOF, empty content, enormous limits, exact fit and one unit short, terminal-vs-partial discontinuity, comma/digit transitions, one remaining astral character, whole stored representations and insufficient useful budget.
- Resolver/CLI: explicit scopes and default precedence, identity required, personal defaults, complete manifest checks on subfiles and local aliases, raw stdout, help and scope-specific missing messages. Keep stdout spies separate from persistent CLI-capture interceptors.
- Actual factory entry: paired and malformed controls, controls on nonread operations, default/supplied allowance, actual counts and full reconstruction using reported next offsets. Assert the factory produced an entry. Preserve captured legacy empty output `"(no output)"` and ordinary diagnostics. Do not mock the resolver, formatter or CLI capture at this boundary.
- Native executor: real resources entry through `executeAgentToolCall()`, normal framework input handling, range validation, correct final completed output, intact footer, no generic truncation suffix and ordinary read compatibility. Use a real persisted Resource fixture if practical, otherwise a storage-boundary fixture with resolver/action/runner real. No external LLM needed. Preserve existing dedupe semantics.

Run the focused baseline and final tests:

```sh
pnpm --filter @agent-native/core exec vitest --run src/scripts/resources/read.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent-single-tool.spec.ts
pnpm --filter @agent-native/core exec vitest --run src/action.spec.ts -t resolveToolMaxResultChars
pnpm --filter @agent-native/core exec vitest --run src/resources/text-range.spec.ts src/scripts/resources/read.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent-single-tool.spec.ts
pnpm --filter @agent-native/core exec vitest --run src/mcp/provider-schema-conformance.spec.ts -t "framework MCP tools"
pnpm --filter @agent-native/core run typecheck
pnpm --filter @agent-native/core run build
```

The new helper spec does not exist for the baseline command. A test that only calls `entry.run()` does not prove native schema admission. A typecheck excludes ordinary spec files and is not a substitute for executing them.

</implementation_verification>
</implementation_tranche>

<implementation_tranche id="resource-range-documentation" agent="general">

### 3. Document and release the implemented contract

This original documentation tranche is superseded by the final public documentation scope recorded below. Only the Core changeset remains in the final diff.

**Mandatory skills:** `concurrent-agents`, `agent-native-docs`, `writing-reference-docs`, `internationalization`, `verifying-changes`, `reporting-progress`. Read each in full and route only to applicable references. Also read `packages/core/docs/AGENTS.md`, this plan and the architecture in full.

1. Read the completed runtime diff and actual behavior evidence. Own only `packages/core/docs/content/agent-resources.mdx`, its ten existing locale counterparts enumerated in the architecture, and new `.changeset/resource-text-ranges.md`.
2. Add concise action-only examples for ordinary read, explicit first range and continuation. Show tool arguments, not a fictitious exported JavaScript `resources()` API. Explain units, actual count, terminal footer, unchanged allowance, live-content/dedupe limitations and full storage reads. Qualify the existing CLI-equivalence wording because no standalone CLI range flags are added.
3. Update the corresponding semantic section in every locale, preserving stable anchors. Translate explanatory prose while retaining accurate literal runtime footer examples. Do not expand an existing i18n-ignore marker, add baselines or weaken guards.
4. Add a minor `@agent-native/core` changeset. Do not bump versions or create a template changelog.
5. Format only owned files and report the diff and verification. Do not edit production code or the plan.

<implementation_verification>

Review all ten translations for parity against the implemented source contract. Run `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy`, plus targeted oxfmt checks and `git diff --check`. Plain prose/fenced examples need no browser. If a custom MDX block is introduced, run the existing docs block validator. The changeset guard only compares committed changes here, so independently inspect package and bump coverage.

</implementation_verification>
</implementation_tranche>

<final_verification_loop id="resource-range-final-proof" verifier="general" verifies="resource-range-runtime,resource-range-documentation" repair_tranches="resource-range-runtime,resource-range-documentation" max_repair_cycles="2">

### 4. Independently verify the final tree

Use a fresh Astra High general agent. This is verification-only. It must not repair source, tests, documentation or guard baselines. Read the full plan/architecture, root/scoped instructions and mandatory skills: `verifying-changes`, `test-audit`, `adding-tests-and-ci`, `internationalization`, `writing-agent-instructions`, `agent-native-docs`, `security`, `actions`, `concurrent-agents`, `reporting-progress`, including the applicable action-fields reference.

1. Inspect the complete final diff and test assertions independently. Verify the exact three production owners, original operation compatibility and input normalization, access ordering, text eligibility, UTF-16 boundaries, maximal fitting and repeated-read semantics. Public MDX is outside the final implementation scope and must match HEAD.
2. Freeze edits during checks. The coordinator adds intent-to-add entries for the exact new task files so diff-scoped guards and mutation include the helper. Confirm inclusion before accepting results. No commit or content staging is authorized.
3. Rerun focused actual-action/native-delivery proof on the final tree. Run Core typecheck/build if the implementation evidence does not cover the same final runtime tree. Run the changed-Core fast lane below and required final-diff checks. Inspect mutation survivors, not only the threshold.
4. Distinguish changed-code failures from independently established baseline/setup failures. Never label SKIPPED/exit 2, omitted new files or empty check scopes as passes. Store task-local diagnostic logs under root `.tmp/` and report exact evidence.
5. Return any failures to the owning original implementer through the coordinator. Allow up to two repair cycles, then raise the remaining issue. After a repair, rerun affected proof against the updated tree. Do not broaden into unrelated baseline cleanup.

```sh
pnpm --filter @agent-native/core exec vitest --run --dir src --changed origin/main --exclude '**/*.db.test.ts' --exclude '**/*.integration.spec.ts' --exclude '**/*.integration.test.ts' --exclude '**/*.e2e.spec.ts' --exclude '**/*.e2e.test.ts' --exclude '**/e2e/**' --exclude '**/*.live.spec.ts' --exclude '**/*.live.test.ts' --exclude '**/*.perf.spec.ts' --exclude '**/*.perf.test.ts' --exclude '**/create-e2e.spec.ts'
pnpm exec oxfmt --check <explicit-final-changed-files>
pnpm exec oxlint --config .oxlintrc.json <explicit-changed-TypeScript-files>
git diff --check
pnpm guard:i18n-catalogs
pnpm guard:i18n-changed-copy
pnpm guards
pnpm mutation:changed
```

Explicit focused specs remain required even if the changed lane reports success. Do not run every future remote-CI acceptance lane locally. Do not launch browser/HTTP/MCP flows unrelated to this action-only capability.

Honor the repository's formatter exclusions. `.prettierignore` excludes `docs/plans/`, so inspect plan artifacts for whitespace and links rather than forcing them through oxfmt. An invocation containing only those ignored paths exits 2 and is not a formatter pass.

</final_verification_loop>

### 5. Complete the handoff

The coordinator records actual results and material deviations below, reviews all task changes, and moves this plan to `docs/plans/completed/resource-text-ranges-implementation-2026-10-30.md` only once required verification is complete. If an important check is blocked, leave the plan in progress and state that gap plainly.

Stop only task-owned processes and leave the parent checkout unchanged. No commit, push, PR, issue, deployment or merge is authorized. Return a concise description of behavior, verification and the architecture/plan links.

## Verification

Success means an explicit ranged read can reconstruct unchanged text through reported next offsets, fits the existing allowance including its footer, preserves native restrictions, and leaves ordinary output intact. The real runner must prove admission and final delivery. Scope, documentation and release metadata must match the result.

### Execution record

- [x] Architecture revised to the agreed plain-text, range-only footer contract.
- [x] Two Explore audits completed. Runtime/input/EOF/cache and verification/setup/localization findings resolved above.
- [x] Existing lockfile dependencies installed in the child worktree. No tracked dependency changes. The documented workspace prebuild supplied test prerequisites.
- Planning-artifact formatter invocation inspected no files because `docs/plans/` is intentionally ignored. This is recorded as not applicable, not a passed check.
- [x] Runtime tranche and local verification. Main-thread diff review found no implementation blocker.
- [x] Documentation/localization/release tranche and local verification. All eleven documents and the Core minor changeset reviewed.
- [x] Independent final verification and two bounded repair cycles.
- [x] Final review and completed-plan transition.

### Runtime evidence

- The three-spec baseline initially failed from missing AgentKit build exports. After `node scripts/prebuild-workspace-packages.ts postinstall`, all **16 tests passed**.
- Three new action/alias cases failed for the intended missing behavior before implementation. Log: `.tmp/resource-range-runtime/red.log`.
- Four focused specs, including the new formatter spec: **133 passed**. Real native executor output at an existing 64-unit allowance contains five emoji and the intact continuation footer, exactly 64 UTF-16 units.
- Existing allowance resolver: **2 passed**. Framework tool-schema conformance: **4 passed**. Core typecheck and build passed.
- Seven-file formatting, lint and `git diff --check` passed. Pre-documentation i18n catalogs passed. Changed-copy inspected zero copy surfaces at this point, so it is not evidence for the later documentation edits.
- Logs and reviewed runtime diff: `.tmp/resource-range-runtime/`. Prebuild generated ignored artifacts only. The formatter and its spec have intent-to-add entries, with no file contents staged.
- Follow-up Explore evidence confirmed provider translators preserve optional fields and explicitly use OpenAI `strict: false`. Native strict admission therefore rejects schema-invalid placeholders rather than provider-required placeholders. Wire tests were inspected in that audit, not executed.

### Documentation evidence

- Added action-only argument examples and literal first/terminal outputs to `agent-resources.mdx` and all ten locale mirrors. Existing CLI blocks and section anchors remain intact.
- The English reference and translations explain actual delivery, unchanged allowances, paired controls, representation limits and current-content behavior. The runtime footer remains literal English protocol text.
- Twelve-file formatting, both i18n guards and `git diff --check` passed. Changed-copy checked **one changed copy surface**. Independent example/parity inspection passed for all eleven documents.
- `.changeset/resource-text-ranges.md` declares `@agent-native/core: minor`. Coverage was reviewed directly because committed-range checks do not prove an uncommitted changeset.
- Logs and documentation diff: `.tmp/resource-range-documentation/`. No material implementation or documentation deviations reported.

### Independent verification and repair cycle 1

- Independent focused proof repeated successfully: **133 tests**, **2 allowance tests**, and **4 schema tests**. Formatting, lint, whitespace, both localization guards and eleven-document example parity passed.
- The stricter compiler guard found `scope: string | undefined` passed to `string[].includes()` in `scripts/resources/read.ts`. Narrow the optional scope using the existing valid-scope semantics. Do not weaken compiler settings.
- Mutation evidence completed through the installed Stryker entry with the same generated configuration: **84.34%**, 209 killed, one timeout, 28 survived and eleven uncovered. The normal wrapper was killed twice and exited 2, so it did not pass. Detailed survivor analysis identified useful U+FFFF, seven-digit footer grouping and malformed direct range-call argument cases. Add these cases to their existing owners. Do not add diagnostic-string tests or duplicate native admission coverage merely to raise the score.
- The SQL guard reports moved Resource arguments reaching unchanged bound SQL. Its own analyzer reports the same behavior on the baseline. Preserve this evidence and diagnose the guard result without changing storage, guard code or baselines.
- The changed-Core lane was interrupted for repair. It reported unclassified failures in `vite/client.spec.ts` and `jobs/background-automation-runner.spec.ts`. Establish their causes and baseline behavior before accepting or excluding them. No completed broad-lane result is claimed.
- Runtime repair owns the existing seven runtime/test files. Broader failure investigation is read-only while that owner edits. Freeze edits before rerunning tests. After repair, rerun affected focused proof, stricter compilation, completed changed-Core verification and relevant mutation coverage.
- Independent evidence and full survivor classifications: `.tmp/resource-range-final-verification/handoff.md`. The verifier restored one automatic, unrelated snapshot-comment rewrite exactly and stopped all owned processes. No file contents were staged.
- Repair cycle 1 narrowed the optional scope and extended existing oracle/direct-call cases. The stricter compiler guard, Core typecheck/build, formatting, lint and whitespace checks passed. Four focused specs now pass **141 tests**. Isolated copies of four relevant mutants produced eight intended failures, without mutating production files. Evidence: `.tmp/resource-range-repair-1/`.
- A read-only parent check confirmed `main` still points to the original updated commit. Its only status entry is this nested task worktree directory. No tracked parent files changed.

### Completed independent verification and repair cycle 2

- The second independent pass repeated **141 focused tests** and completed the changed-Core lane: **16,346 passed, two failed, two expected failures** across 613 files. The lane failed. Its two immediate assertion failures also reproduce through bounded baseline paths that never load the changed Resource modules.
- The unchanged Vite fixture fails because of `/var` versus `/private/var` temporary-path resolution. Changing only `TMPDIR` to its canonical path makes its isolated case pass. The unchanged Builder fixture inherits `OPENAI_API_KEY` and selects OpenAI. Removing only that inherited variable makes its isolated case pass. These are controlled diagnostic passes, not a passing original-environment broad lane or a complete baseline-suite run. No unrelated fixture repair belongs to this change.
- The remaining changed-code failure is strict lint on `scope !== undefined` in the missing-Resource CLI diagnostic. Normal compilation treats the indexed value as a string, while stricter compilation permits undefined. Replace the condition with equivalent known-scope comparison that satisfies both configurations. Do not change either guard, add suppressions or broaden behavior. This is the second and final planned repair cycle.
- Mutation completed directly with the generated 26-range configuration: **87.01%**, 220 killed, one timeout, 25 survived and eight uncovered. A controlled native-executor configuration completed at **90.55%**, 229 killed, one timeout, 24 survived and zero uncovered. Native coercion and hook mutants were assertion-killed. The remaining timeout is an infinite-loop mutant detected by the hit limit. All survivors were reviewed. The normal wrapper still exits 2 after SIGKILL, so it did not pass.
- Coordinator disposition: the SQL guard remains failed because its existing analyzer treats bound argument arrays as SQL text. Baseline/current analyzer evidence and the unchanged parameterized store establish the false positive. No SQL, guard, pragma or baseline edit is authorized or needed for this Resource feature. The mutation-wrapper failure is an execution limitation, with successful direct equivalent-range runs providing supplemental behavioral evidence. Neither failed command is relabeled as passed.
- Full second-pass evidence, exact environment comparisons and survivor classifications: `.tmp/resource-range-final-verification-2/handoff.md`. All 21 task paths were preserved. Two automatic snapshot-comment rewrites were restored exactly, and all owned checks stopped.
- After the small diagnostic-condition repair, rerun both strict guards together, affected CLI/focused tests, formatting, lint, whitespace and Core typecheck/build. Inspect mutation effects on the changed condition using the existing ignored diagnostic setup if useful. Reuse the completed broad lane and unchanged-helper/native mutation evidence rather than repeating unrelated expensive checks. Final review must confirm the exact task diff and completed cleanup.

### Final result

- Repair cycle 2 replaced the conflicting optional-scope condition with an equivalent `.some(value => value === scope)` comparison. The existing diagnostic table now explicitly covers unsupported scope. No range behavior changed.
- Both strict-lint and compiler-strictness guards passed their actual changed-code scopes. **142 tests passed** across the four focused specs, including the real action and native executor. Core typecheck/build, seven-file formatting/lint and whitespace checks passed on the final runtime tree.
- Two isolated copies of the changed condition produced five intended assertion failures. Broader mutation percentages above describe the pre-final-condition tree. The independent reviewer accepted their reuse for unchanged feature paths together with this exact-delta proof. The normal wrapper remains failed, not passed.
- Independent final review confirmed the exact two-file repair, all other task paths unchanged, empty staged contents and unchanged HEAD. It found no remaining feature-proof gap or user decision. Evidence: `.tmp/resource-range-repair-2/` and `.tmp/resource-range-final-verification-2/final-review.md`.
- The final production scope is exactly three files. The four specs, eleven localized/reference documents, Core minor changeset and these two planning artifacts complete the task. All ten translations were also reviewed by the coordinator.
- A final read-only parent check confirmed its tracked working tree is clean and `main` remains at the original updated commit. All task-owned checks have stopped. No browser/server remains, and no commit, push, issue, PR, deployment or merge occurred.
- The plan is filed as completed because feature implementation and its required behavioral proof are complete. The two original-environment broad-test failures, SQL analyzer false positive and wrapper execution failure remain explicitly recorded limitations, not silently waived passing checks.

### Requested follow-up: smaller read diff and convention audit

The user reopened this work to reduce changes to `scripts/resources/read.ts` while preserving the working solution. The follow-up also requires checking meaningful scenario coverage and whether error handling follows the repository's `fail()` conventions at each layer.

- [x] Read-only Explore review of the smallest coherent extraction/adapter shape against the original file.
- [x] Read-only Explore scenario matrix covering existing CLI/resolution behavior, range semantics, native admission and delivery.
- [x] Read-only Explore review of `fail()`, typed errors, missing results and capture at the CLI, action and shared-helper boundaries.
- [x] Record the selected minimal adjustment, then delegate implementation to Astra High with narrow source/test ownership.
- [x] Verify the changed behavior and guard-sensitive paths, review the final delta, and return this plan to completed.

Preserve the agreed action-only public contract, existing limits, ordinary output, native resolution and complete-content access checks. Reduce churn without duplicating resolution or introducing an awkward abstraction solely to save diff lines. Add tests only for credible missing scenarios. Keep all existing parent-checkout and no-publication boundaries.

#### Selected adjustment and audit findings

Keep `resolveResourceForRead(path, scope): Promise<Resource | null>` and its existing action caller. Restore the original CLI placement, explicit resolution branches and literal missing-resource messages. Replace the original private output helper with a private `checkResourceForRead()` that returns the Resource after the existing complete-content Lab check. Keep classification and flat-manifest lookup based on the resolved canonical path, while errors retain the requested path. This reduces change against upstream without a formatter callback, output emitter or second result protocol. Before the follow-up, Git reports `read.ts` as 52 additions and 92 deletions. Measure the final Git diff rather than promising the audit's approximate one-third reduction.

The error audit confirms that `scripts/utils.ts` re-exports `action.ts`'s `fail()`. Both throw `ActionContractError`, with the helper defaulting to `action_failed`/400. CLI adapters conventionally import through script utilities. Domain helpers and action adapters may import the action primitive directly. An absent checked lookup stays `null`, the ranged action converts that to typed 404, and CLI missing diagnostics retain their legacy behavior. Lab denials and unavailable settings remain typed 403/503. The strict-admission hook returns a rejection message according to its existing contract. No error convention correction is required.

Error propagation here means errors that reach the checked resolver. The unchanged granted-workspace resolver already catches some storage failures and returns `null`. This follow-up neither repairs that inherited behavior nor promises that all native storage outages propagate.

The scenario audit found strong existing proof for paired strict controls, Unicode/EOF/large values, maximal fitting, exact delivery budgets, full reads, continuation reconstruction and representation eligibility. Existing store, local-artifact and agent-loop suites own access, path safety and generic dedupe. Additional proof belongs at the gaps below rather than duplicating those suites.

<implementation_tranche id="resource-range-read-churn" agent="general">

**Mandatory skills:**

- `concurrent-agents`: preserve the current task-owned diff and re-read before editing.
- `agent-native-docs`: use current source and documented contracts rather than historical examples.
- `actions`, including its action-fields reference: preserve typed failure conventions and the existing action contract.
- `security`: retain canonical-path Lab checks and native resolution/access boundaries.
- `test-audit` and `adding-tests-and-ci`: add only behavior-discriminating cases at their existing owners.
- `verifying-changes`: prove the actual action path and affected compiler/guard contracts.

1. Own only `packages/core/src/scripts/resources/read.ts`, `packages/core/src/scripts/resources/read.spec.ts`, `packages/core/src/server/agent-chat/script-entries.spec.ts`, and `packages/core/src/resources/text-range.spec.ts`. Read the full current architecture, this plan and the original `HEAD` version of `read.ts` before editing. Preserve all prior task changes outside this slice.
2. Implement the selected minimal structure. Keep CLI help/required-path placement, literal scope-specific diagnostics, raw stdout and empty behavior. Restore explicit workspace/shared/personal/default fallback branches and original initialization timing. Retain the resolver's production-used export, native owner/org semantics and full Lab check. Do not change the action adapter, formatter production code or public interfaces.
3. Strengthen the existing action routing fixture to key storage results by both owner and path, with competing personal/shared/workspace content. Exercise explicit shared and workspace reads of a non-default path, asserting the exact delivered text so dropped/misforwarded selectors fail.
4. Extend existing resolver scope cases for explicit shared organization miss to legacy shared hit, and no-org default fallback through shared to workspace. Cover successful `all` and unsupported CLI scope fallback since branch structure changes. Add a defaults-ordering case where asynchronous initialization creates the requested personal Resource ahead of an existing shared fallback.
5. Extend existing Lab cases with a flat gated skill, a subfile whose gated manifest is inherited from another owner, and ungated/missing-manifest positive controls. Preserve disabled/enabled and unreadable-settings outcomes. At the action boundary, add unavailable-Lab-settings typed 503 and a native storage rejection that remains the same exception rather than becoming CLI text or 404.
6. Strengthen existing validator/formatter failure assertions with the typed contract and 400 status where useful. Reuse the already-covered 403/404 and actual native strict-admission proofs. Do not add private-hook tests, duplicate Unicode/budget cases, source-reading assertions, or tests merely for diagnostic wording. Current-content/dedupe behavior is unchanged and retains its existing proof boundaries.

<implementation_verification>

- Run the four focused specs explicitly: `src/resources/text-range.spec.ts`, `src/scripts/resources/read.spec.ts`, `src/server/agent-chat/script-entries.spec.ts`, and `src/agent/production-agent-single-tool.spec.ts`, via Core's Vitest command. Confirm actual action and native executor cases remain in the run.
- For new fixture-sensitive tests, demonstrate that wrong action routing and omitted initialization waiting would fail through isolated temporary copies or another bounded negative control. Do not edit production files while tests run. No full mutation rerun is required solely for this structural refinement, and prior scores are not measurements of this new tree.
- Run Core typecheck/build, format and lint the owned files, and run both strict guards. Run `guard:no-raw-sql-interpolation` because moved-call classification may change. A remaining established false positive must stay visible, without guard/store edits or suppression markers.
- Check the final diff against both the pre-follow-up tree and upstream. Report exact `read.ts` additions/deletions and assert the public contract and other production owners remain unchanged. Keep logs in `.tmp/resource-range-read-churn/`, stop owned processes and return actual results. Reuse unrelated verified documentation, localization and baseline-failure evidence rather than rerunning the broad lane without a new concern.

</implementation_verification>
</implementation_tranche>

The coordinator reviews the reduced diff and coverage matrix, obtains a fresh independent review of the final implementation and evidence, records remaining limitations honestly, and files this plan as completed only when the follow-up proof is complete. Unexpected feature failures return to the implementer for a bounded repair. An unrelated store, guard or interface redesign requires a new scope decision.

#### Follow-up result

- Against upstream, `read.ts` changed lines fell from **144 to 86**, a **40.3% reduction**. The diff is now 50 additions and 36 deletions, compared with 52 additions and 92 deletions before this follow-up. This measures review churn, not source-file length. The final file has 199 lines, compared with 185 upstream.
- The CLI retains its original placement, explicit branches and literal diagnostics. The appended resolver shares the existing complete-content gate through `checkResourceForRead()`. Its contract, canonical-path Lab checks and error conventions remain intact. The action adapter and production formatter are byte-identical to the prior implementation.
- Added coverage discriminates owner and path routing, organization and no-org fallback, awaited personal initialization, flat/inherited/ungated skill manifests, typed failures and unexpected storage exceptions. Existing tests retain Unicode, fitting, continuation, ordinary reads and real native-executor proof.
- **155 tests passed** across the four focused specs. Isolated copies with dropped scope, wrong path and omitted initialization awaiting produced **five intended assertion failures**. Three unmutated controls passed. These controls show the new cases detect the intended regressions.
- Core typecheck/build, owned formatting/lint, both strict guards and whitespace checks passed. Strict lint inspected seven changed files and compiler strictness inspected one opted-out project. The SQL guard still failed with five findings in the established bound-argument analyzer false-positive path. No waiver or guard/store change was added.
- Exactly the four assigned follow-up files changed. Other task files, other production owners, HEAD and the parent checkout remained unchanged. There are no staged contents or remaining owned processes. Prior broad-lane and mutation results were not rerun or presented as measurements of this refined tree.
- The coordinator reviewed the exact follow-up diff. A fresh Astra High reviewer independently checked the code, coverage and frozen evidence and recommended closure with no concrete repair or meaningful coverage gap. Reports and command logs are in `.tmp/resource-range-read-churn/`, including `handoff.md`, `integrity.json` and `independent-review.md`.

### Earlier public documentation refinement

- The user requested a narrower public reference, following Adviser's prose-authoring, harness-editing and existing-document guidance. This replaces the earlier comprehensive public-documentation checklist. The architecture retains the detailed design and verification limits.
- Each of the eleven MDX files now adds one short range subsection. It explains the paired controls, units, continuation footer, configured allowance and ordinary-read behavior through two worked calls. Existing prose is restored apart from the necessary change from equivalent CLI commands to corresponding CLI commands.
- English explanatory prose fell from 389 to 127 words. Across all locales, the upstream diff fell from 539 additions and 22 deletions to 329 additions and 10 deletions.
- Formatting, both i18n guards, literal-example parity and whitespace checks passed. The ten nonowned task files were byte-identical during the refinement. This was documentation-only, so no runtime check applies. Evidence is in `.tmp/resource-range-docs-trim/`.

### Final public documentation scope

- The user requested removal of all MDX changes unless existing wording had become incorrect. The existing description of equivalent CLI operations remains valid and does not promise identical optional arguments.
- All eleven MDX files were restored byte-for-byte to HEAD, including the original wording. No range section or example remains. This supersedes both earlier documentation tranches.
- The residual MDX diff is empty. Whitespace checks passed and all ten nonowned task files were unchanged during restoration. No runtime or localization check was needed for an exact restoration. Evidence is in `.tmp/resource-range-docs-revert/verification.log`.

### Approved image-URL adjustment and convention review

The user approved returning stored image URLs intact rather than rejecting them when a read includes range controls. Images already use provider URLs in Resource content. This adjustment preserves that existing read representation.

- [x] Complete a read-only convention audit of the three changed production owners.
- [x] Return image URLs intact within the existing allowance, clarify the tool description, and add focused behavioral proof.
- [x] Review the final diff and evidence independently, then return this plan to completed.

Valid paired controls still select range mode. For an image URL, their numerical values do not select a substring. Return the original stored URL with no footer. If the entire URL cannot fit the resolved tool-result allowance, use the existing typed failure contract rather than truncate it. Ordinary reads keep their current behavior. Text containing a literal URL remains text and follows the existing code-point range contract.

The convention audit confirmed the existing module ownership, `.js` and type-only imports, checked resolver, `fail()` usage, strict-input hook and internal action adapter. It found no reason for another refactor. The store already validates image content using `isPersistableAttachmentUrl()` and the upload handler stores provider URLs. Match its case-insensitive image MIME classification without repeating URL validation in a reader that neither fetches nor executes the URL. Preserve the stored string verbatim.

Keep representation handling in the Resource-owned formatter after the checked resolver completes access checks. Do not fetch images, attach image bytes, extend other binary behavior, change shared budgets, or restore public MDX changes. Preserve the reduced `read.ts` extraction. The inherited CLI capture and factory error behavior do not require unrelated repairs.

<implementation_tranche id="resource-range-image-url" agent="general">

**Mandatory skills:** `concurrent-agents`, `agent-native-docs`, `actions` with its action-fields reference, `storing-data`, `security`, `test-audit`, `adding-tests-and-ci`, `writing-agent-instructions`, and `verifying-changes`. Use the matching existing owner and error conventions rather than introducing another abstraction.

1. Read this complete plan and architecture, the convention findings above, and the existing image persistence/read contracts before editing. The audit does not authorize a different action architecture or unrelated repairs.
2. Own only `resources/text-range.ts`, `resources/text-range.spec.ts`, `server/agent-chat/script-entries.ts`, `server/agent-chat/script-entries.spec.ts`, and `agent/production-agent-single-tool.spec.ts` beneath `packages/core/src/`. Limit the action source change to the relevant tool and parameter descriptions. Leave `scripts/resources/read.ts` and its tests intact.
3. Before text eligibility and offset checks, recognize `resource.mimeType.toLowerCase().startsWith("image/")` and return the exact stored content when `content.length <= maxResultChars`. Otherwise use `fail()` with `resource_range_budget_too_small`, its default 400 status and an image-specific message. Do not add a URL validator/import, normalize content or modify request-control validation. Preserve all text selection and fitting behavior.
4. Replace the image-rejection fixture with owner-level proof for nonzero or very large offset, `limit: 1`, exact allowance, insufficient allowance and mixed-case image MIME. Strengthen the literal-URL text case with an actual partial range. Other unsupported representations still reject.
5. At the actual action boundary, use the existing fixture collection to prove an image subfile under a disabled Lab-gated skill is denied before returning its URL. At the real native executor, prove exact-boundary URL success without a footer or generic truncation, and insufficient-allowance failure with the typed budget code rather than a successful fragment. Keep action, resolver, formatter and executor real. Reuse existing admission/access fixtures instead of repeating their matrices.

<implementation_verification>

- Demonstrate the current implementation fails the intended image-URL cases before the fix. Run all four focused Resource/read/action/native-executor specs after the change.
- Run Core typecheck/build, formatting and lint for modified files, both strict guards, and whitespace checks. Check relevant changed action-description copy guidance without adding MDX or localization work for the stable tool protocol.
- Prove the image allowance boundary through observable output and typed failure. No broad-suite or full mutation rerun is required unless a new failure justifies it. Previous mutation percentages are historical, not measurements of this new tree.
- Record exact changed paths, command outcomes and unchanged MDX/read-resolver identity in `.tmp/resource-range-image-url/`. Keep the prior SQL analyzer failure visible. Do not change the store, guards, budgets, manifests, lockfiles or parent checkout. Stop owned processes and leave all work uncommitted.

</implementation_verification>
</implementation_tranche>

#### Image-URL result

- The formatter now uses the store's case-insensitive image MIME convention and returns stored content verbatim without slicing or a footer. A URL exceeding the UTF-16 result allowance fails through `fail()` with `resource_range_budget_too_small`/400. The action-source adjustment is limited to three description strings.
- The baseline had 155 passing focused tests. New image cases produced five intended failures against the old formatter. After correcting a native test fixture's length and repeating failing-first proof, all **160 tests passed** across the four focused specs. Exact 64-unit native delivery, 65-unit failure, mixed-case MIME, ignored offsets, partial literal-URL text and Lab denial are covered.
- Core typecheck/build, both strict guards, five-file formatting/lint and whitespace checks passed. The i18n catalog guard passed. Changed-copy checked zero applicable surfaces, which is not translation coverage. The earlier SQL analyzer false positive remains a failed check and was not rerun. Broad-lane and mutation evidence remains historical, not a measurement of this final tree.
- The coordinator reviewed the exact five-file delta. A fresh Astra High reviewer checked all three production owners, current fixtures, actual logs and frozen hashes and found no concrete repair or remaining proof gap. All sixteen captured nonowned files were unchanged, including the read resolver and all eleven MDX files. Evidence: `.tmp/resource-range-image-url/handoff.md`, `integrity.json` and `independent-review.md`.
- All owned checks stopped. The work remains uncommitted, the index contains no staged contents, and the parent checkout was not changed.

### Approved review simplification: comments 4, 6 and 8

The user explicitly approved removal of the discard bindings and the entire branch-added strict-admission override. The unchallenged recommendation for comment 4 is to restore the upstream tool summary. Comment 5's shortened parameter descriptions are already actioned. Comment 7 is resolved without another change because both read modes already use the checked resolver. Questions about earlier typing, other range readers and Flow registration remain read-only investigations.

This tranche supersedes earlier raw-input rejection requirements and their test expectations. Preserve native input normalization rather than adding a conditional replacement hook or changing the shared runner. The range schema and handler retain their numeric bounds and pairing checks after normal framework preparation.

- [x] Remove the branch-only override and redundant bindings, and restore the upstream summary.
- [x] Prove native argument compatibility and retained range behavior.
- [x] Complete independent review and record the exact scope and verification limits.

<implementation_tranche id="resource-range-review-simplification" agent="general">

**Mandatory skills:** `concurrent-agents`, `actions` and its action-fields reference, `test-audit`, `adding-tests-and-ci`, `writing-agent-instructions`, and `verifying-changes`. Also read the Adviser `review-comments` skill and its handling/report references. Keep stable comment decisions and change only approved items.

1. Own `packages/core/src/server/agent-chat/script-entries.ts`, its adjacent spec, and `packages/core/src/agent/production-agent-single-tool.spec.ts`. Read this plan, the architecture and the upstream versions of those files. Preserve all other task changes and every MDX file.
2. Restore the original action/rest destructuring and remove only this branch's strict-validator registration, its dedicated AJV instance and newly unused imports. Prefer the upstream registry-return shape where the intermediate binding existed solely for the override. Do not change the shared strict-input mechanism or native runner.
3. Remove the branch-added range sentence from the overall tool description, retaining the upstream summary and comment 5's short parameter descriptions. Do not change other copy or range semantics.
4. Replace branch-only tests that demand stricter raw admission with proof of the framework's normal behavior through the real Resource entry and native executor. Cover normalized numeric controls, removal of invalid optional placeholders, ordinary-call compatibility and remaining invalid normalized ranges. Retain exact text/image delivery, access, pairing and bounds proof. Do not retain a hook-presence or registry-spread test solely for the removed override.

<implementation_verification>

- Run the four focused Resource/read/action/native-executor specs with the real action/resolver/formatter/executor at their existing test boundaries. Demonstrate compatibility cases fail under the current strict override before removal where practical.
- Run Core typecheck/build, format and lint modified files, both strict guards, applicable copy guards and whitespace checks. Use a narrowly explained `oracle-change` only where restoring the explicitly requested upstream behavior changes earlier branch-only assertions. Never weaken range correctness to satisfy a guard.
- Keep diagnostics in `.tmp/resource-range-review-simplification/`. Prove the other production owners, unowned tests and all MDX files are unchanged. Do not rerun the broad lane or full mutation campaign without a new concern, and do not relabel earlier failures as passing.
- Return exact changes and proof to the coordinator for an independent review. No browser verification is claimed by these deterministic tests. No commit, push, publication, parent edit or new framework behavior is authorized.

</implementation_verification>
</implementation_tranche>

#### Review-simplification result

- Removed the dedicated AJV instance, strict-input registration and unused imports. Restored the upstream registry-return shape, action/rest destructuring and overall tool summary. Comment 5's concise parameter descriptions remain unchanged. No replacement validation hook or shared-runner change was introduced.
- The production delta is four additions and 25 deletions in `script-entries.ts`. Only its native-executor spec also changed. The formatter, checked resolver, adjacent action spec and all MDX files remain byte-identical to the incoming tree.
- Eleven compatibility cases failed against the removed override. The final four-spec run passed **164 tests**. Native numeric coercion, optional-placeholder removal, ordinary reads and writes, remaining invalid normalized ranges, exact text/image delivery and access checks are covered. Storage is mocked at the adapter boundary, so the write case does not claim persistence proof.
- Core typecheck/build, formatting/lint, both strict guards, the oracle guard, copy guards and whitespace checks passed. Changed-copy inspected zero applicable surfaces. The historical SQL analyzer false positive, original-environment broad-lane failures and mutation-wrapper limitation remain recorded failures rather than passes. No browser verification occurred.
- A fresh Astra High reviewer corroborated the logs, reconstructed the exact two-file delta, verified frozen hashes, unchanged MDX, unchanged HEAD and empty staged contents, and found no concrete repair or new proof gap. Evidence: `.tmp/resource-range-review-simplification/handoff.md`, `integrity.json` and `independent-review.md`.
- Questions about numeric typing and neighboring range conventions remain recommendations for user review. They did not authorize changes to the helper's types, representation policy or code-point contract. The Flow registration explanation is source-based, not a browser-test result. All owned checks have stopped, and all work remains uncommitted.

### Approved review comments 1–3

The user approved the typing and neighboring-reader recommendations and requested implementation before reviewing again. Comment 9 requires no changes. Earlier results above are historical evidence, not proof of this revised tree.

- [x] Update the selected contract and reopen this plan.
- [x] Implement the approved input, UTF-16 and representation changes with focused regression proof.
- [x] Independently review the final diff and checks, then return the plan to completed for user review.

<implementation_tranche id="resource-range-reviewed-contract" agent="general">

**Mandatory skills:** `concurrent-agents`, `agent-native-docs`, `actions` with `references/action-fields.md`, `security`, `performance`, `writing-agent-instructions`, `test-audit`, `adding-tests-and-ci`, and `verifying-changes`. Read the root/scoped instructions, full current architecture and this plan before editing. Apply the already-requested Adviser review-comment and prose guidance to the narrow edits.

1. Own only `packages/core/src/resources/text-range.ts`, its adjacent spec, `packages/core/src/server/agent-chat/script-entries.ts`, its adjacent spec, `packages/core/src/agent/production-agent-single-tool.spec.ts`, and `.changeset/resource-text-ranges.md`. Preserve the checked read resolver, its spec, all MDX, shared runner/admission, budgets, stores, public exports and plugin registration.
2. Give the validator explicit typed fields `action: string`, `offset?: number`, and `limit?: number`. Give the handler explicit known numeric range fields rather than relying on unknown values. Retain runtime checks for direct calls. Keep legacy dynamic dispatch and unrelated write code intact instead of inventing a raw-input model or refactoring other operations to obtain types. Malformed-input tests must still exercise the runtime boundary honestly.
3. Follow the existing attachment reader's UTF-16 convention in `server/attachment-actions.ts:504–535`. Clamp past EOF and adjust a boundary only when it splits an actual high/low surrogate pair. Include a complete pair when a one-unit request would otherwise make no progress. Isolated surrogate units stay within the requested window. Counts use actual substring length, total uses `content.length`, and continuation uses the actual end index. Avoid a whole-content code-point scan. Do not copy the attachment reader's defaults, caps, hydration or public result shape.
4. Keep the complete-response allowance and existing footer. Check the actual terminal candidate before fitting partial candidates. Select the largest permitted boundary that fits body plus footer. When even one complete character and footer cannot fit, retain the typed budget failure. Use a small index-based fitter and standard number formatting, not a new shared reader abstraction, generic truncation wrapper or full-document array.
5. Dispatch known inline `text/*`, exact `application/json` and native local text to the text formatter. Return every other stored representation exactly as stored, without a footer, if it fits the existing allowance. Otherwise fail with the existing typed budget code. Remove the image-only exception and unsupported-representation error. Do not guess URLs, broaden MIME normalization, fetch, decode, parse JSON, change storage or add representation metadata.
6. Update the concise parameter descriptions and Core changeset to UTF-16. Update only tests whose approved contract changed, and add meaningful coverage for whole non-image content and surrogate-boundary continuation. Preserve existing native normalization, paired controls, access checks, legacy full reads and image exact/oversize proof. Explain oracle changes as the user-approved UTF-16/pass-through contract, not weakened assertions.

<implementation_verification>

- Establish the four-spec baseline, then demonstrate selected changed-contract cases fail on the incoming implementation. Run the four focused specs after implementation: `src/resources/text-range.spec.ts`, `src/scripts/resources/read.spec.ts`, `src/server/agent-chat/script-entries.spec.ts`, and `src/agent/production-agent-single-tool.spec.ts` through Core Vitest with external `DATABASE_URL` unset.
- Use an independent small brute-force oracle or equivalent boundary proof. Cover starts inside a pair, one-unit astral requests, terminal footer discontinuity, exact/insufficient allowance, past EOF, enormous limits, literal URL text, whole non-text/reference content and reconstruction through actual next offsets. Preserve complete-content access proof. Do not mock the action/resolver/formatter/executor being tested.
- Run Core typecheck/build, formatting/lint for modified files, both strict guards, the oracle guard, applicable copy guards and `git diff --check`. Use only a narrowly justified oracle marker if the approved contract genuinely requires it. Do not weaken guards or introduce suppressions.
- Store evidence in `.tmp/resource-range-reviewed-contract/`. Compare frozen hashes of unowned files, all MDX against HEAD, exact task paths, empty staged contents and unchanged HEAD. Stop owned processes. Prior broad-lane, SQL-analyzer and mutation-wrapper limitations remain recorded, not rerun or relabeled without a new reason. No browser test is claimed or required by this review request.
- Return actual results and a concise diff summary for independent review. No commit, push, publication, parent changes or unrelated refactor. The coordinator owns plan/architecture updates and closes this tranche only after reviewing the proof.

</implementation_verification>
</implementation_tranche>

### Independent review repair for comments 1–3

The first implementation passed 167 focused tests, typecheck/build and scoped guards. Independent calls then exposed a boundary defect: `A\uDC00B` with limit 1 repeats offset 1, and `😀\uDC00B` duplicates a unit. A lone high surrogate can also expand a window unnecessarily. The selected-window oracle repeated the neighboring reader's one-sided boundary assumptions, so its single-call agreement did not prove continuation.

This is a repair to the promised exact reconstruction and forward progress, not a change to the neighboring reader or the approved range units. Evidence is in `.tmp/resource-range-reviewed-contract/independent-review.md`.

1. The original implementer owns only `packages/core/src/resources/text-range.ts`, its spec, and `packages/core/src/server/agent-chat/script-entries.spec.ts` for this repair. Require both halves of an actual pair for start and requested-end adjustments. Preserve the existing partial fitter, genuine-pair expansion, counts, passthrough and allowance.
2. Correct the independent oracle's boundary classification. Extend bounded reconstruction coverage with isolated low surrogates, using actual returned offsets and requiring strict forward progress and exact concatenation. Add literal window expectations for isolated high surrogates alongside a real-pair positive control. Demonstrate the new assertions fail against the current implementation before the repair.
3. Freeze the final source and run all four focused specs, Core typecheck/build, owned formatting/lint, both strict guards, the oracle guard and whitespace checks. Reuse unchanged copy evidence. Keep exact repair and integrity evidence in `.tmp/resource-range-reviewed-contract-repair/`, leave all nonowned files and MDX unchanged, and stop owned processes.
4. Return the actual delta and proof to the independent reviewer before closure. The suggested move into `read.ts` remains an unapproved recommendation and is not part of this repair.

#### Final result for comments 1–3

- The validator and action handler now declare their known numeric range fields. Runtime pairing and bounds checks remain, with the framework's existing argument preparation unchanged.
- Text ranges use UTF-16 indices and counts. The formatter clamps past EOF, preserves actual surrogate pairs, uses standard number formatting and fits the complete response with an index-based partial search. Other stored representations pass through whole within the same allowance, without an image-only exception or unsupported-representation error.
- The initial changed-contract cases produced 31 intended failures before implementation. Independent review then found the isolated-surrogate continuation defect despite 167 passing tests. Five corrected oracle, literal-window and actual-action reconstruction assertions failed before the two actual-pair predicates were repaired.
- The final four-spec run passed **172 tests**. Core typecheck/build and dist imports, owned formatting/lint, both strict guards, the oracle guard and whitespace checks passed against frozen source. Prior copy checks apply to unchanged descriptions and MDX. Earlier broad-lane, SQL-analyzer and mutation-wrapper failures retain their recorded status and are not passing checks for this tree.
- Independent review reran bounded assertions against the built formatter and confirmed exact reconstruction, strict continuation progress, real-pair expansion and preserved isolated units. It verified the exact three-file repair, frozen hashes, unchanged nonowned files and MDX, unchanged HEAD and empty staged contents. No remaining repair was identified. Evidence: `.tmp/resource-range-reviewed-contract-repair/handoff.md`, `integrity.json` and `independent-review.md`.
- All owned checks have exited. No browser, Flow server, live database or provider verification is claimed. The approved changes are ready for user review. The helper-placement suggestion remains a recommendation, and all work remains uncommitted.

### Terminal-footer refinement

The user approved keeping the leading `...` only when more content remains. An explicit range at EOF returns `[Returned … characters; end of resource]` after the existing separator. Partial footers retain their existing text. This supersedes the earlier terminal examples.

- Change only the footer renderer in `resources/text-range.ts` and its existing formatter, action and native-executor tests. Preserve literal Resource content, including any footer-like text stored in the Resource.
- Update the independent oracle, terminal expectations and reconstruction checks. Prove the shorter terminal footer fits exactly at its new allowance boundary and fails or selects the correct partial page one unit below it. Keep partial ellipses covered.
- Run the four focused Core specs, modified-file formatting/lint, both strict guards and whitespace checks against frozen source. The existing Content server and browser must remain open for the user's testing. Do not change `.env`, MDX, read resolution, representation handling, argument policy, or helper placement.
- Record actual evidence under `.tmp/resource-range-terminal-footer/`, review the small delta, and return this plan to completed. Earlier broader-check limitations remain historical results.

#### Terminal-footer result

- The renderer now adds `...` only when more content remains. This is one changed production line. Three existing specs update generated terminal expectations, exact budget boundaries and reconstruction-prefix checks. Stored footer-like text remains literal content.
- Five selected assertions failed against the old renderer. The final four-spec run passed **172 tests**. Modified-file formatting/lint, both strict guards, the oracle guard and whitespace checks passed. Ten ASCII units and their terminal footer now fit exactly in 53 UTF-16 units, with typed failure at 52 when no useful partial page fits.
- Coordinator review confirmed the exact four-file delta and integrity evidence. All nonowned files and MDX, HEAD and staged contents were preserved. Evidence: `.tmp/resource-range-terminal-footer/handoff.md`, `delta.diff` and `integrity.json`. No broad test run, build or new browser/provider check was performed for this one-line refinement.
- The earlier Content browser/provider run verified read-only Resource continuation with the previous footer. Its evidence remains in `.tmp/content-readiness/credential-verification/post-env-agent-proof.json`. The Content server, browser and ignored credential file were left intact for the user's manual testing.

### Relocate range code into the Resource reader

The user explicitly approved moving the range code into `scripts/resources/read.ts`. This supersedes earlier placement recommendations and separate-module file lists. It is a behavior-preserving relocation.

- [x] Move the existing helper code and tests, update the action caller, and remove both separate range files.
- [x] Verify the relocated reader and actual action/executor paths, review the exact move, and close this plan.

<implementation_tranche id="resource-range-reader-placement" agent="general">

**Mandatory skills:** `concurrent-agents`, `agent-native-docs`, `actions` and its action-fields reference, `test-audit`, `adding-tests-and-ci`, and `verifying-changes`. Read the full current plan and architecture before editing.

1. Own only `packages/core/src/scripts/resources/read.ts`, its existing `read.spec.ts`, `packages/core/src/server/agent-chat/script-entries.ts`, and the two files being removed: `packages/core/src/resources/text-range.ts` and `text-range.spec.ts`.
2. Move the existing range interface, validation, formatting and private helpers into the existing read script. Reuse its `fail()` import, which re-exports the same action primitive. Import the local Resource identity helper from its existing owner. Keep signatures, conditions, literal output and algorithms unchanged.
3. Use the already-loaded `read` module for validation and formatting in `createResourceScriptEntries()`. Remove the separate static range import. Do not reorganize other action dispatch, resolution, CLI behavior or registration.
4. Merge the existing range test helpers and suites into `scripts/resources/read.spec.ts`, preserving every case and assertion. Keep the resolver/Lab mocks scoped as before and use the real local-identity predicate. Do not introduce a new test file, mock the relocated formatter, or add tests for the move itself. Remove the two original range files.
5. Remove only the two deleted files' empty intent-to-add index entries after checking that no contents are staged. Preserve all other worktree changes, public MDX, the ignored local credential file, the parent checkout, and the running Content server/browser. No publication or dependency changes.

<implementation_verification>

- Freeze source and run `pnpm --filter @agent-native/core exec vitest --run src/scripts/resources/read.spec.ts src/server/agent-chat/script-entries.spec.ts src/agent/production-agent-single-tool.spec.ts` with external `DATABASE_URL` unset. The existing 172 tests should now reside in three specs.
- Run Core typecheck/build, modified-file formatting/lint, both strict guards, the oracle guard and whitespace checks. Confirm the built reader exports and real action registration work from their new ownership. There is no new behavior requiring a failing-first test or a broader mutation/suite rerun.
- Compare moved function/test bodies and all nonowned file hashes against the pre-move snapshot. Report any necessary import/mock adjustment. Confirm no production reference to the removed module remains, all eleven MDX files still match HEAD, staged contents are empty, and owned checks have exited. Keep the user's existing Content server/browser running.
- Store actual evidence under `.tmp/resource-range-reader-placement/`. Earlier SQL-analyzer, environment and mutation-wrapper limitations remain historical results, not newly passing checks.

</implementation_verification>
</implementation_tranche>

The coordinator reviews the relocation and evidence, updates the current file map, and returns this plan to completed. Historical records above describe the files and checks at those earlier stages.

#### Reader placement result

- Range implementation and test bodies moved byte-for-byte into `scripts/resources/read.ts` and `read.spec.ts`. The existing reader, CLI and Lab test lifecycle changed only where imports were needed. `script-entries.ts` uses its already-loaded `read` module for the two helper calls. Both separate range files were removed.
- The final feature has two production owners and three test specs. **172 tests passed across all three specs**. Core typecheck/build, built-reader exports and real registration checks, modified-file formatting/lint, both strict guards, the oracle guard and whitespace checks passed on frozen source.
- Coordinator review confirmed the exact relocation and actual check results. All sixteen nonowned snapshot files were preserved, all eleven MDX files match HEAD, staged contents remain empty, and only the deleted files' empty intent-to-add entries were removed. Evidence: `.tmp/resource-range-reader-placement/handoff.md`, `delta.diff`, `integrity.json`, `verification-hashes.json` and `actual-checks.json`.
- Owned verification processes exited. The user's Content app, browser and ignored credential file were left intact. This relocation adds no new browser/provider proof. Historical SQL-analyzer, original-environment broad-lane and mutation-wrapper limitations retain their recorded status. No commit, push or parent-checkout change occurred.

### Final PR preparation, November 2, 2026

- The user requested final checks and a linked issue draft using Adviser's `agent-native-github-bug-reporting` guidance. The issue and PR remain local drafts at `.output/agent-native-resource-read-continuation-bug-report.md` and `.output/resource-text-ranges-pr.md`. The PR contains an issue-number placeholder for publication. No feature commit, push, issue, PR or comment was authorized or published.
- Reproduced the issue on npm stable `@agent-native/core@0.222.2`. A synthetic 150,057-character Resource persisted completely, but ordinary, middle and tail requests all delivered the same first 50,000 characters plus the truncation notice. The reproduction uses the published chat plugin, Resource store and native agent loop with a deterministic engine, not a provider or browser. Subsequent engine invocations within that loop received the same truncated outputs. Independent draft review confirmed the evidence and corrected that execution wording. Evidence: `.tmp/resource-range-latest-stable/`.
- A fresh pre-update Content browser/provider run verified the relocated code and corrected EOF footer. The agent read `memory/MEMORY.md` at offsets 0 and 11, returned 11 and 4 UTF-16 units, and reconstructed the 15-unit seed exactly. The partial footer retained `...`; EOF omitted it. Nine composer update-depth errors were also recorded. Retained logs lack the timing and stack detail needed to establish their cause or relationship to Resource execution. Evidence: `.tmp/resource-range-pr-browser/`. No post-base-update browser verification is claimed.
- The initial final guard sweep still failed on the known bound-argument SQL false positive. At the user's request, investigation found upstream PR #8516 already fixed it. The real upstream analyzer cleared the five Resource findings while retaining unsafe SQL controls. The user then explicitly approved updating this task branch to main rather than adding the guard repair to the feature diff.
- Fast-forwarded only `patt1s0n/resource-text-ranges` from `70b1b9f641e9e1c7178fa7f52a454105add01481` to `ee6264cf4443bdca6f8847b65cbf23d2bdaefce2`. All eight feature files, complete feature diff and intent-to-add entries were preserved. Parent `main` remains at the original SHA. Locked dependencies were installed without tracked manifest changes.
- Fresh checks after integration passed: 172 tests across three focused specs, Core typecheck/build and built-reader proof, formatting/lint, both strict guards, both localization guards, oracle, secrets, whitespace, the actual SQL guard and its 93 self-tests. The full sweep passed 99 substantive guards; PR-title validation was inapplicable without a PR. An initial macOS temporary socket-path failure was corrected through execution setup, with failed logs retained and no guard weakening.
- The affected-Core lane passed 16,808 tests across 644 files, plus two expected failures. All 622 planned files were covered; ordinary filename matching included 22 additional files. The actual `pnpm mutation:changed` wrapper passed at 88.84% over 251 mutants with the unchanged threshold, ranges and selected specs. A controlled run confirmed that score and classified remaining loop hit-limit timeouts. These are new passing results, not relabeled historical failures. Evidence: `.tmp/resource-range-main-update/handoff.md`, `actual-checks.json`, `integrity.json`, `mutation-review.md` and associated logs.
- Survivor review identified four useful surrogate-boundary strings and a slash-normalized skill-path fixture for the existing reader spec. Other survivors include redundant conditions, diagnostic prose and schema behavior outside the wrapper's selected specs. They do not justify production changes, superficial string assertions or test-selection changes.
- Added those five fixtures to the existing reader tables. The independent oracle and all production files remain unchanged. Final verification passed **177 tests across three specs**. Targeted variants of the real reader confirmed that new assertions catch mutants 0, 96, 99, 108 and 109, with all 103 reader tests passing against the control. The full mutation wrapper was not rerun after these test-only additions, so 88.84% remains the preceding full-run score. Formatting, both strict guards, oracle and whitespace checks passed. Because normal lint excludes spec paths, lint also passed against a byte-identical ignored `.ts` copy under the unchanged lint configuration. Coordinator review confirmed the small delta and proof. Evidence: `.tmp/resource-range-final-fixtures/handoff.md`, `delta.diff`, `proof.json`, `target-mutant-proof.json` and check logs.
- Remaining publication-time proof is dependent-workspace CI, SSR cold-start smoke, standalone AgentKit Chat acceptance, remote mutation-shard orchestration, commit-range changeset and actual PR metadata checks. No remote required-check pass is claimed. Owned checks exited; the existing Content app, primary browser tab and ignored credential file remain available for manual testing.

### Publication authorization, November 3, 2026

The user approved publishing the reviewed issue first, then committing and pushing this branch and opening its linked PR. Standalone PR babysitting includes fixing actionable CI and review failures and inspecting suspected flaky failures before retrying. A justified empty commit is authorized when a fresh head is needed to rerun CI. Keep the PR open once checks and feedback are clean. No merge, parent-checkout change or shutdown of the user's Content instance is authorized.
