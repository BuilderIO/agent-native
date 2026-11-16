# Story 8. Security alert to safe fix

**Prompt.** "For new security alerts, check whether the vulnerable code is actually used. Safe upgrades go to Builder. Critical or unclear ones go to the security owner. Unused ones are dismissed."

**Goal.** Security alerts are judged for whether they matter in this repository. Safe upgrades go to Builder as a pull request, and a person gets everything else.

**Input.** The repository's open Dependabot (dependency) security alerts. GitHub lists every open alert on every run, so the Source skips the ones already handled.

**Output.** One of:

- Builder has a task for a safe upgrade and the alert is `automation_started` (the merge is followed by story 2);
- the security owner is told by Slack and email and the alert is `needs_manual` (critical, unclear, a major upgrade or code change, or a fix that touches a sensitive area);
- the alert is `dismissed` with the model's reason, when the model is confident the vulnerable code is not reachable and the severity is low or medium.

**Runs.** Hourly.

**Needs.** GitHub (a token that can read security alerts), Slack, the workspace email sender and Builder.

**Waits.** None.

## The path

1. **`alerts` (Source, provider query, remembered in the inbox):** `github.listSecurityAlerts` for the repository setting. A token without the scope fails the run with `credential_missing`; it never reads as an hour with no alerts.
2. **`assess` (AI, per alert, read-only tools `github.readFile` and `github.searchCode`):** `severity`, `reachable`, `fixKind` (patch, minor, major, code change), `confidence`, and the Builder gate fields `clearBug`, `risk`, `productUxImplications`, `categories`, plus a `reason`.
3. **`route` (Switch), first match wins:**
   - **Safe fix:** a patch or minor upgrade, severity not critical, confidence high, a clear bug, low risk, no product or design question, and no sensitive category. Goes to `builder`.
   - **Not reachable:** reachable is false, severity is low or medium, and confidence is high. Goes to `dismissed` with the model's reason.
   - **Otherwise:** to the security owner.
4. **`builder` (Agent, `builder.start`):** project from the `builderProjectId` setting (the one story 2 follows), asking for the branch `factory-alert-<alert number>` (Builder keeps a name of its own, and `handed` records the one it returned, which is what story 2 follows; nothing here compares the two), a task made of two parts, and the gate fields bound from the assessment (`alreadyClaimed` is fixed false: a dependency alert is not a chat message). **The model writes the instruction**: it names the package, the fixed version if the alert names one, and the manifest, asks for that upgrade and nothing else, and asks Builder to run the tests that cover code using the package and list under a `### Verified` heading in the pull request description which tests or commands ran and whether they passed (an upgrade has no screenshots, and no regression test is asked for). **The host writes the facts**: `reports` is bound to the alert's `item.id`, and the start reads the alert from Factory's inbox and adds, after the instruction, its title, link, severity, package, ecosystem, manifest path, fixed version, GHSA id and advisory text, as recorded, so a model that leaves the package, the version or the manifest out of its instruction still sends them (`builder-task-text.spec.ts`). The alert's fixed version is read from GitHub's own field (`security_vulnerability.first_patched_version`) and left out when the alert has none yet. Then `handed` (End, done, status `automation_started`, recording the task's address as `builderUrl` too).
5. **`notify` (Slack) and `notifyEmail` (email)** to the security owner, then `manual` (End, needs_manual).

```mermaid
flowchart LR
  t[Hourly] --> src[Source: GitHub security alerts] --> ai[AI: assess, reads repo] --> route{Switch}
  route -->|Safe fix| builder[Agent: Builder start task] --> handed[End: handed off, automation_started]
  route -->|Not reachable| dismissed[End: dismissed, with reason]
  route -->|Otherwise| notify[Slack and email to security owner] --> manual[End: needs_manual]
```

## What it must never do, and where that is enforced

- **Dismiss a high or critical alert.** The `unreachable` route requires severity `low` or `medium` (node settings), and the proof asserts across every scenario that no high or critical alert ends dismissed. An alert the model cannot decide never dismisses either: a failed AI turn fails the alert and writes no status.
- **Dismiss an unclear alert.** The `unreachable` route also requires confidence `high`, so "probably unused" goes to a person. (The first draft dismissed on `reachable: false` alone.)
- **Change anything in the repository.** The graph's only writes are `builder.start`, Slack and email, and the model's tools are exactly the two read-only repository operations; both are catalog reads, which the proof asserts. Builder does the change through a pull request that story 2 gates.
- **Give the model write tools or code execution.** `assess` can only name catalog read operations as tools; the graph validator refuses a write.
- **Start Builder for something the dispatch gate refuses.** The gate (clear bug, low risk, high confidence, no product question, not claimed, no never-automate category, no duplicate) runs inside `builder.start`, before Builder is called; the route mirrors it, so what the model rates unsafe never reaches it. When the gate refuses anyway (a duplicate), the alert fails at `builder` and goes to a person at once: the same start would be refused again. Asserted in the host's `builder-start-gate` and `builder-operations` specs; the scenarios here assert the engine's side.
- **Start Builder twice for one alert.** The start is a write under a receipt keyed by the alert. A start that timed out may have gone through, so the alert is held for a person and never sent again; a start that was refused had no effect, would be refused again, and goes to a person without a retry.

## Not in this version

- The hand-off to story 2 has only run in memory. The `handed` End writes `builderTaskId`, `projectId`, `branchName`, `builderUrl` and `repository` onto the alert's row (`expect.json` asserts them under `recorded`, and `server/workflow/stories/handoff.spec.ts` runs story 2 on them, also when Builder returns another branch name than the one asked for). Nothing has run that hand-off on Beta.
- An alert handed to Builder is listed by GitHub again until its fix merges, and `automation_started` does not count as handled, so it is assessed again every hour (a model call each time; its Builder start is found already done). A model that then changed its mind could move it to `needs_manual`.
- Code scanning alerts: only Dependabot alerts are read.
- A refusal by the gate is not announced: the alert goes to a person without a message.
- Builder following the ask. The `### Verified` block is asked for, and story 2's merge gate refuses a pull request whose description has no Verified section (`no_verification_evidence`), so the resulting pull request goes to a person instead of merging. A manifest or lockfile change is held by the gate's `security` rule whatever the description says. The scenarios here script the model's answer and no real Builder pull request has run through the gate.

## Scenarios

- `each-alert-lands-where-the-story-says`: six alerts, each route: a safe patch to Builder, a critical alert, a high-severity alert the model thinks unreachable, an unreachable one it is unsure of and a major upgrade to the security owner, and one confidently unreachable low-severity alert dismissed.
- `a-fix-that-touches-a-sensitive-area-goes-to-a-person`: a patch the model rates safe that touches auth never reaches Builder.
- `an-ai-turn-that-fails-never-dismisses-the-alert`: the alert fails, nothing is written.
- `a-refused-start-hands-the-alert-to-a-person-at-once`: one refusal, `needs_manual`, no retry on the hours after.
- `a-start-that-timed-out-is-never-sent-twice`: needs a check, held for a person, not started again when the alert is listed again.
- `an-alert-handed-to-builder-is-listed-again-and-builder-is-not-started-twice`: the known re-assessment above, with no second start.
- `a-token-that-cannot-read-alerts-fails-the-run-loudly`: a failed run, no AI, no status.
- `a-dry-run-hands-nothing-to-builder-and-tells-no-one`: the full routing, no writes.
