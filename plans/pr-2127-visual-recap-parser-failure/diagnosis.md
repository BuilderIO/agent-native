# Why did PR #2127's visual recap fail after validation?

## Answer

The recap failed because the generated `plan.mdx` contained a literal newline
inside a JavaScript double-quoted string in the `code` property of the
`lib/media-upload.ts` annotated-code block. `remark-mdx` handed that malformed
attribute expression to Acorn, which rejected it at `plan.mdx:173:17` with
`Could not parse expression with acorn`.

The agent and recap CLI had validated only the JSON envelope and a few recap
invariants. Neither parsed the embedded MDX before the CLI sent it to the hosted
`create-visual-recap` action. The first real MDX parse therefore happened in the
hosted Plan app, after the one-shot agent turn had ended.

This is not a transient deployment or authentication failure. It is a
deterministic authoring error crossing an incomplete validation boundary.

## Evidence

### Exact malformed source

The diagnostic artifact from [workflow run 29357225929](https://github.com/BuilderIO/agent-native/actions/runs/29357225929)
contains the rejected `recap-source.json`. In its `mdx["plan.mdx"]`, line 173
starts the `code` string for `templates/mail/server/lib/media-upload.ts`. The
string's internal newlines are escaped as `\n`, except for its final newline:

```mdx
code: "export const MAX_UPLOAD_BYTES = ...\n }\n}
",
```

That raw newline terminates neither the string nor the surrounding expression
legally. Replaying the file through `unified + remark-parse + remark-mdx`
reproduces the production error at line 173, column 17. Replacing only that raw
newline with `\n` makes the whole document parse successfully (13 top-level AST
children), with no second syntax error.

### What the agent actually validated

The run transcript shows the agent used Node and `jq` to verify:

- the source was valid JSON;
- the file tree contained 18 unique entries;
- block IDs were unique;
- five key-change tabs existed;
- expected tags such as `Endpoint`, `FileTree`, and `TabsBlock` existed;
- no simple secret pattern matched.

It then reported the file as "JSON-validated." It did not run an MDX parser,
Plan import, or local Plan check. The statement was accurate only in the narrow
JSON sense and misleading as a publish-readiness claim.

### The CLI validation gap

`validateRecapSourcePayload` in
`packages/recap-cli/src/recap.ts:2716-2766` checks that the outer value is an
object, metadata values are strings, `mdx` is an object, and `plan.mdx` is a
non-empty string. `readRecapSourcePayload` at `:2769-2792` performs
`JSON.parse` and calls that envelope validator.

`publishRecapSource` then forwards the unchanged MDX in the request body at
`packages/recap-cli/src/recap.ts:2916-2988`. There is no MDX syntax validation
between reading the file and POSTing it.

That omission is understandable: `@agent-native/recap-cli` explicitly describes
itself as dependency-light and does not depend on the Plan template's MDX parser
or block registry (`packages/recap-cli/package.json:2-49`). Importing the entire
Plan parser into the CLI would increase its weight and could still drift from
the deployed Plan registry.

### Where the real validation occurs

The hosted import action calls `parsePlanMdxFolder` and converts parse failures
to HTTP 422 (`templates/plan/actions/import-visual-plan-source.ts:97-121`).
`parsePlanMdxFolder` validates file shapes, then parses `plan.mdx` before content
normalization (`templates/plan/server/plan-mdx.ts:1715-1757`). The parse itself
uses `unified`, `remark-parse`, and `remark-mdx`
(`templates/plan/server/plan-mdx.ts:370-376,1012-1015`).

Recap salvage does not help here. `salvageInvalidBlocks` is applied during
normalization after a complete MDX AST exists. Acorn fails before that point, so
there is no block tree to salvage.

### Missing test coverage

The recap publisher test proves that a shaped payload is forwarded and a URL is
accepted (`packages/core/src/cli/recap.spec.ts:465-547`). The malformed-source
test covers only a missing/non-empty `plan.mdx` string (`:703-714`). There is no
test for syntactically malformed MDX in an otherwise valid `recap-source.json`,
nor a workflow test for repairing a deterministic 422.

## Inferences

- The immediate defect was model-authored escaping, not corruption during JSON
  serialization or HTTP transport. The malformed newline is already present in
  the uploaded artifact.
- Rerunning the workflow might happen to produce valid escaping, but it would
  not close the validation gap.
- The warning about the unrelated `agent-native-toolkit` skill's missing YAML
  frontmatter did not cause this failure. The agent completed authoring and the
  hosted parser independently reproduced the MDX error.
- The workflow's fallback wording that "the publisher will validate the final
  MDX" overstates the local publisher's role. The publisher forwards the MDX;
  the hosted action validates it.

## Recommendation

Keep the hosted Plan parser as the source of truth and add one bounded repair
loop rather than embedding a second, potentially drifting parser in the recap
CLI:

1. Preserve MDX parser position data when converting import errors to 422. The
   response should name the file plus line and column, for example
   `plan.mdx:173:17: Could not parse expression with acorn`.
2. When recap publishing receives a deterministic authoring 422, run one repair
   turn with the rejected source and exact diagnostic, then publish once more.
   Do not retry authentication, authorization, secret-scan, or unrelated 4xx
   failures as content repairs.
3. Retain both source versions and the repair transcript in the workflow
   artifact. Keep the existing idempotency key so a repair cannot create a
   duplicate recap.
4. Correct the workflow copy so it distinguishes JSON-envelope validation from
   hosted MDX validation.

A separate hosted `validate-visual-plan-source` dry-run endpoint is reasonable
if other clients need preflight, but it is not required to fix this workflow.
Using the existing create action's pre-write parse keeps validation and publish
on the same deployed parser version and avoids an extra network round trip.

## Acceptance boundary

The issue is ready for implementation when the intended behavior is:

- malformed MDX is rejected before any plan row, update, asset, visibility, or
  sharing mutation;
- the diagnostic includes the MDX filename, line, and column;
- the workflow makes at most one content-repair turn for a deterministic 422;
- the repaired source is parsed by the same deployed parser used to publish it;
- a second failure leaves a clear non-blocking PR comment and both source
  artifacts, without looping;
- valid recaps retain the current one-agent-turn fast path;
- tests reproduce this exact raw-newline fixture and cover successful repair,
  exhausted repair, and non-repairable 4xx behavior.

## Uncertainties

- The current action wrapper may discard structured VFile position fields and
  retain only `Error.message`; implementation should inspect the thrown
  `remark-mdx` error shape in the Plan runtime before choosing the response
  schema.
- A repair turn's model/provider selection should match the original authoring
  backend unless there is an explicit fallback policy. This is an operational
  choice, not part of the parser diagnosis.

## Sources

- [PR #2127](https://github.com/BuilderIO/agent-native/pull/2127)
- [Visual recap failure comment](https://github.com/BuilderIO/agent-native/pull/2127#issuecomment-4972549553)
- [Workflow run 29357225929](https://github.com/BuilderIO/agent-native/actions/runs/29357225929)
- `packages/recap-cli/src/recap.ts`
- `packages/recap-cli/package.json`
- `templates/plan/actions/import-visual-plan-source.ts`
- `templates/plan/server/plan-mdx.ts`
- `packages/core/src/cli/recap.spec.ts`
