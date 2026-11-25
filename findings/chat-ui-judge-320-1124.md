# chat-ui-judge 320-character rejection (11/24)

Ref: exp-chat-ui-judge-r3-1124

Status: NOT RUN. No root cause found and no fix shipped, because the code under
investigation is not in this repository.

## What was checked

Run against `builderio/agent-native` at `origin/main` (b8fcf8fd).

- No `chat-ui-judge`, `chat-ui-grade`, `fleet-ops` or `bin/quality.ts` file or
  string exists in the tree. Searches for `chat-ui`, `fleet-ops` and
  `chat-ui-judge` find nothing relevant.
- No `320` limit on a judge verdict exists. The `320` matches are layout
  constants and unrelated zod limits in other templates.
- The only judge in the tree is the factory pull request judge
  (`templates/factory/server/lib/pull-request-judge-calibration.spec.ts` and
  `.../02-builder-to-merge/fixtures/judge-calibration.json`). It judges PR
  evidence, not chat UI, and `engine/nodes/ai.ts` has no length cap.
- No harness logs and no chat-ui fixtures exist here.
- No model credential is available in this container, so no judge could be run.

## Requested outputs

| Item                              | Value                                    |
| --------------------------------- | ---------------------------------------- |
| ERRORS-BEFORE                     | not measured (no harness logs available) |
| ERRORS-AFTER                      | not measured                             |
| Fresh sample of 20+ chat-ui cases | not run (no fixtures, no credential)     |
| Raw outputs JSON artifact         | none, deliberately not fabricated        |
| Agreement and variance            | not computed                             |

## Owner note

Where the limit is enforced is still open. Check these three places, in order:

1. The verdict schema. Look for a `maxLength` or `.max(320)` on the rationale
   or reason field. If the prompt asks for more than the schema allows, the
   schema is the wrong side.
2. The prompt. It should state the same character budget as the schema, as a
   hard cap on the field, not a hint.
3. Any truncation before validation. A cut-off verdict is a failed run, not a
   short one, and must not be coerced into a valid-looking value.

Fix by making the schema and prompt agree on one limit constant. Do not raise
the limit unless the limit itself is wrong. The failing-first test should feed
a verdict of 321 characters and assert a typed failure, then a 320 character
verdict and assert it passes.

Re-run the experiment in a checkout that contains chat-ui-judge, the harness
logs, the chat-ui fixtures and a sandbox judge credential.
