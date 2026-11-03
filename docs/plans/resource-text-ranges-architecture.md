# Text ranges for the `resources` action

**Status:** Implemented and verified in the existing Resource reader. The [completed implementation plan](completed/resource-text-ranges-implementation-2026-10-30.md) records the relocation and verification evidence.

**Original design baseline:** `70b1b9f641e9e1c7178fa7f52a454105add01481`. Core, Toolkit, and AgentKit declare version `0.222.2`.

**PR verification base:** `ee6264cf4443bdca6f8847b65cbf23d2bdaefce2`, following the user-authorized fast-forward to main on November 2, 2026. The eight feature files were preserved byte-for-byte during integration.

**Worktree:** `/Users/david.pattison/Code/agent-native/.orca/worktrees/agent-native/resource-text-ranges`, branch `patt1s0n/resource-text-ranges`.

The source checkout at `/Users/david.pattison/Code/agent-native` was updated before this task. All implementation work belongs in this child worktree. The source checkout, its branches, and its Orca metadata remain outside this task.

## Outcome

An agent can read successive portions of one native Resource through the existing `resources` action. Known inline text returns a selected range and a short continuation footer. Other stored representations return whole without a footer. Ordinary reads keep their current output.

This is content ranging within one Resource. Skills are one consumer of the same capability.

## Baseline behavior and evidence

All source references in this section describe the original design baseline above. They are source-inspection evidence, not runtime proof.

| Owner | Current behavior |
| --- | --- |
| `packages/core/src/server/agent-chat/script-entries.ts:385–524`, `createResourceScriptEntries()` | Defines the built-in `resources` action, including its argument schema and dispatch. Read requires a path and invokes the captured CLI script. It has no text `offset` or `limit`. |
| `packages/core/src/scripts/resources/read.ts:17–185` | Resolves identity, path, and scope. Checks the complete applicable skill manifest. Writes the whole `resource.content` string. |
| `packages/core/src/resources/store.ts:1646–1727` | `resourceGet()` and `resourceGetByPath()` resolve complete Resources. Their native resolution includes SQL, local-file, and granted-workspace sources. |
| `packages/core/src/action.ts:164–191` | Resolves the existing tool-result allowance and supplies it as `ActionRunContext.maxResultChars`. The normal default is 50,000 UTF-16 units, subject to existing configuration and hard limits. |
| `packages/core/src/agent/production-agent.ts:11053–11060` | Passes string results through, truncates oversized results with JavaScript string slicing, and appends its generic truncation notice. Resources does not currently perform that truncation. |

The existing browser/store exact-ID reads are separate working interfaces. The neighboring workspace-file reader has UTF-16 `offset`/`maxChars` slicing, but it is not a native Resource range contract.

An earlier draft incorrectly included MCP's 2,000-character formatter limit. Registry inclusion alone does not establish external exposure. `mcp/action-eligibility.ts:85–137` and `mcp/build-server.ts:498–509` exclude this built-in framework action. A2A filters also exclude it. No MCP/A2A-specific budget branch belongs in this implementation.

## Ownership and flow

```text
resources read without range controls
  -> existing whole-read path and output

resources read with offset and limit
  -> action validates controls and obtains the existing result allowance
  -> reused read-script resolver loads and checks the complete Resource
  -> read-script formatter returns stored content whole or fits text and a short footer
  -> one plain-text string
  -> existing tool runner
```

The production change has two owners:

```text
packages/core/src/
├── server/agent-chat/script-entries.ts   # Existing action schema and dispatch
└── scripts/resources/read.ts            # Checked read resolution and range formatting
```

`createResourceScriptEntries()` remains the action owner despite its directory name. It selects the read mode and passes the already-resolved allowance.

The internal `resolveResourceForRead(path, scope)` reuses the read script's authenticated identity, personal/shared/workspace precedence, defaults, and complete-manifest restrictions. Its explicit resolution branches return through `checkResourceForRead()`, which completes the Lab gate before returning the Resource. The CLI uses the same resolution while retaining its help, raw output, and literal missing-resource diagnostics. The ranged action consumes the checked Resource directly, rather than treating captured CLI diagnostics as Resource content.

`validateResourceTextRange()` and `formatResourceTextRange(resource, range, maxResultChars)` live beside the checked resolver in the existing read script. The formatter fits known inline text with its counts and footer, and preserves other stored content whole. Its supplied allowance is a number, not an agent context. These are internal module exports, not new public package APIs. The action uses its already-loaded read module.

## Request contract

The existing tool name, `action: "read"`, path selector, and scope rules remain authoritative.

```ts
resources({
  action: "read",
  path: "notes/project.md",
  offset: 500,
  limit: 1000000
})
```

- Neither control supplied means the existing read behavior.
- Both controls supplied means an explicit range read.
- Supplying only one is invalid. There is no new implicit page size or automatic range mode.
- `offset` is a zero-based, nonnegative safe integer.
- `limit` is a positive safe integer specifying the requested text length. Following the attachment reader's boundary convention, a one-unit window containing the first half of a surrogate pair expands to include the pair.
- The handler checks numeric controls after the framework's existing argument normalization and schema validation. Fractions, negative values and unsafe integers remain invalid.
- Range controls apply only to `action: "read"`. Other operations reject them rather than reinterpret them as list pagination.
- A large valid limit, including `1000000`, is accepted. The existing result allowance can reduce the amount delivered. There is no new arbitrary text-count ceiling.

For representations outside the known-inline-text classification, valid range controls do not select a substring. The complete stored content is returned without a footer, subject to the same result allowance. This includes image and other provider URLs.

Use explicit numeric `offset` and `limit` fields in the action's TypeScript input and a narrow typed validator input. Retain runtime pairing and numeric-bound checks. This does not change the framework's normal argument handling or create a raw-unknown input model.

Keep the runner's existing input repair, scalar coercion and schema validation. Do not register a Resource-specific strict-input override or duplicate the runner's validation machinery. The range handler still checks paired controls and their numeric bounds, including direct invocation.

The controls above are those delivered to the handler. The framework may normalize numeric strings or remove invalid optional placeholders. If both controls are removed by that existing process, the handler performs an ordinary read. This feature does not introduce a new raw-input policy for Resources or other operations.

## Text unit and result

Range values count UTF-16 code units, following `read-attachment` in `server/attachment-actions.ts:504–535`. Clamp the requested start to the content length. Adjust a start or end only when it splits an actual high/low surrogate pair. Include the complete pair when backing off would produce an empty page. Isolated surrogate units remain within the requested window. Combining marks and joined emoji are not grapheme-segmented.

The selected text is preserved exactly. No trimming, normalization, frontmatter removal, newline conversion, or JSON parsing occurs. CR and LF count separately. Existing isolated surrogates remain unchanged. `Resource.size` remains its existing byte-size metadata.

The public result stays a string. A partial range uses this footer shape:

```text
<selected Resource text>

...[Returned 12,000 characters; 80,000 total; next offset 12,500]
```

`Returned` is the delivered substring's UTF-16 length, not the requested limit. `Total` is the complete string length. The next offset is the actual end index, which accounts for an adjusted start and any budget reduction. Continue from that reported offset rather than adding the requested limit.

An explicit range that reaches the end uses:

```text
<selected Resource text>

[Returned 800 characters; end of resource]
```

The leading ellipsis appears only when more content remains. Both footer forms are confined to explicit range reads. Ordinary reads gain no footer, terminal marker, JSON envelope, or new result type.

### Boundaries and failures

| Condition | Outcome |
| --- | --- |
| Empty content at offset zero | Empty text with a terminal footer reporting zero returned. |
| Offset equals total | Empty terminal result. |
| Offset exceeds total | Clamp to the end and return an empty terminal result, matching the attachment reader. |
| Limit exceeds remaining text | Remaining text and terminal footer, unless the result allowance requires another page. |
| Invalid controls or nonread action | Invalid-range error. |
| Other stored representation | Exact stored content without a footer. Fail if it cannot fit the result allowance. |
| Missing Resource or failed access check | Failure, not a successful page containing diagnostics. Preserve existing disclosure restrictions. |
| Allowance cannot fit the footer and useful text without splitting a surrogate pair | Failure rather than a successful zero-progress result. Empty terminal results must also fit. |

Use the existing `ActionContractError`/`fail()` contract for failures. Do not add a new error framework.

## Existing result allowance

The action uses `ActionRunContext.maxResultChars`. If invoked directly without this context value, it uses the existing `DEFAULT_TOOL_RESULT_CHARS`. The existing resolver owns action/configuration/hard-cap precedence.

The formatter selects the largest permitted prefix whose complete response fits:

```text
selected text + separating newlines + complete footer
```

The budget measure and range unit are both JavaScript string length, in UTF-16 units. The response is already plain text, so JSON escaping and an object envelope are not part of this calculation.

Calculate the footer from the actual selected prefix and check the final complete string. Shrinking text can change numeric widths or switch between partial and terminal footer shapes. The fitting algorithm and tests must account for those boundaries. Never build a response and crop its completed footer afterward.

Check the complete terminal candidate first when the requested window reaches EOF. Only then search partial candidates, whose cost is monotonic. For example, ten ASCII characters and the terminal footer occupy 53 units, while nine characters and the partial footer occupy 62. A single binary search across both forms is incorrect.

Return offsets based on delivered text, never the requested limit. This keeps continuation correct when the requested window is larger than the existing allowance. The shared runner keeps its current policy and receives a fitted Resource response.

This guarantee covers the live Resource response prefix. Existing history compaction and replay can discard old results. This feature does not create durable document assembly or a new history contract.

## Resolution, representations, and consistency

Authorization and content-dependent restrictions run before slicing. A skill range that omits restrictive frontmatter still requires access to its complete manifest. Native local-file path safety and workspace grant checks remain at their existing resolution boundaries.

Use the resolved Resource's canonical path for skill classification. The local reader accepts `.agents/skills/` and `.agent/skills/` aliases, but the baseline Lab gate only recognized requested paths beginning with `skills/`. Canonical classification restores that existing restriction without adding a new permission policy. Keep the requested path for diagnostics.

Text selection follows existing native text conventions: inline `text/*`, exact `application/json`, and text guaranteed by the native local-file reader, including its YAML/XML files. The native local Resource identity establishes that source guarantee, not arbitrary metadata supplied by a caller.

Other representations return their stored content intact. This replaces both the image-specific exception and unsupported-representation rejection. It does not infer a representation from URL spelling, revalidate a storage reference, fetch a file or decode a payload. The existing output allowance still bounds the complete result.

The stored string is the readable material. A literal URL in a text Resource stays literal URL text. Do not guess representations from URL spelling, fetch provider-backed files, decode binaries, or extract PDF content. The current Resource model cannot distinguish every incorrectly tagged external pointer from intentional URL text. MIME normalization must not classify provider uploads as inline text when the current upload writer treats them differently.

Each executed read sees current content and repeats native resolution and authorization. The existing runner can reuse or suppress an identical read-only call. Keep that deduplication policy unchanged and do not promise a fresh read for a cached repeat. Successive continuation offsets are different requests. For unchanged content, following their offsets reconstructs it exactly. Edits, scope overrides, or grant changes between executed calls can change the result. No hash, revision token, or snapshot control is introduced, and the footer carries no identity/version fields.

Full content still loads before selection. String length and UTF-16 indices avoid the former whole-content code-point scan. This bounds returned text, not database or file reads. Avoid creating an array for the complete document or allocating memory proportional to an oversized requested limit.

The footer, action descriptions, and typed diagnostic messages are stable agent-tool protocol text, following the existing English tool/truncation convention. They do not introduce localized interface controls or a locale-dependent continuation syntax. The action's parameter descriptions explain the range controls.

## Exact implementation file map

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/core/src/server/agent-chat/script-entries.ts` | Existing, required | `createResourceScriptEntries()`, read-only parameter descriptions, runtime validation, mode dispatch, and existing allowance forwarding. Preserve Plan-mode classification and shared-write approval. |
| `packages/core/src/scripts/resources/read.ts` | Existing, required | Checked resolution, typed range validation, representation dispatch, UTF-16 selection, footer and exact fitting. Preserve `resourceReadScript()`, scope fallback, `requireSkillLabAccess()`, and CLI behavior. |
| `packages/core/src/scripts/resources/read.spec.ts` | Existing, required | Checked resolution, scope/access, CLI behavior, range/surrogate boundaries, preserved text, whole representations, terminal output, fitting and error contracts. |
| `packages/core/src/server/agent-chat/script-entries.spec.ts` | Existing, required | Real action invocation, parameter validation, continuation, supplied allowance, and legacy behavior. |
| `packages/core/src/agent/production-agent-single-tool.spec.ts` | Existing, required | Invoke the real Resources entry through the existing executor. Prove existing input normalization, range validation, exact delivery, intact footer, and legacy output. |
| `.changeset/resource-text-ranges.md` | New, required | Additive Core capability release note with a minor changeset. |

The user removed public MDX documentation from the implementation scope. All eleven reference and locale files were restored exactly to the baseline.

Public barrels, package export maps, browser hooks, HTTP routes, stores, execution budget owners, and MCP formatters are not implementation targets. No standalone CLI range flags or new action name are introduced.

## Verification and execution boundary

Explore audited this design against the source before implementation. The audit covered numeric argument handling, checked resolver extraction, fitting around footer-length transitions, native result transforms, useful-progress failures, and available behavioral test harnesses.

Proof covers complete reconstruction through reported offsets, maximum requested limits under smaller actual allowances, surrogate boundaries, malformed controls, EOF and empty text, scope/access restrictions, whole stored representations and their allowance boundary, and ordinary reads without a footer. Run real action wiring rather than asserting source text.

Use existing Core Vitest lanes and the required formatter, localization, type, guard, and changed-Core checks applicable to the final diff. Keep implementation-local checks separate from final verification by a fresh Astra High subagent.

After relocation and the authorized main update, 172 tests passed across three focused specs, including actual action and native-executor cases. Fresh Core typecheck/build, built-reader checks, formatting/lint, both strict guards, localization, oracle, secret and whitespace checks passed. The affected-Core lane passed 16,808 tests across 644 files, plus two expected failures. The full guard sweep passed with 99 substantive checks and an inapplicable PR-title check. Main includes the SQL-analyzer fix from PR #8516, whose 93 self-tests also passed.

The actual changed-line mutation wrapper passed at 88.84% with the unchanged threshold and scope. A controlled run confirmed the score and distinguished loop hit-limit detections from wall-clock timeouts. The survivor review identified useful UTF-16 endpoint and slash-normalized skill-path fixtures. Evidence is in `.tmp/resource-range-main-update/`, including the full check ledger and survivor review. Earlier failed setup and verification attempts remain recorded as historical results.

The final test-only pass added those five fixtures to existing reader tables without changing the independent oracle or production code. All 177 focused tests passed. Ignored variants of the real reader confirmed that the new assertions catch each targeted mutation: 0, 96, 99, 108 and 109. Formatting, lint, both strict guards, oracle and whitespace checks passed. Evidence is in `.tmp/resource-range-final-fixtures/`. The 88.84% full mutation result predates these additions; the supplemental check does not claim a new full score.

A real Content browser/provider run after the footer refinement and relocation reconstructed a Resource through two native reads, including the terminal footer without an ellipsis. That run preceded the main update. Nine composer update-depth errors were also observed, with cause and timing relative to Resource execution unestablished. No post-update browser run is claimed. The independent issue reproduction used published Core `0.222.2`, real persistence and the native agent loop with deterministic engine submissions.

Dependent-workspace CI, SSR smoke, standalone AgentKit Chat acceptance, remote mutation-shard orchestration, commit-range changeset and actual PR metadata checks remain for publication. The linked implementation plan records the exact proof boundaries and local issue/PR draft paths.

On November 3, 2026, the user authorized publishing the issue, committing and pushing this work, opening the linked PR, and babysitting its CI and review feedback. The PR remains open for review when clean. Merging and changing the parent checkout are outside that authorization.
