# Clips Background AI Requests Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** "Remove silences", "Remove filler words", and the other recording-page AI requests start every time, run at most once, and show an honest failure when they cannot start.

**Architecture:** Today an action writes a request into a single app-state slot per recording. An open browser tab then relays it into whichever agent-chat panel happens to be mounted, and confirms delivery within 10 s. Since `cfedd4369` (#6207), recording pages have no mounted chat receiver unless the Agent tab is selected. So delivery silently times out and retries until the user happens to open that tab. This plan removes the dependency on a mounted chat UI:

- Silence removal becomes deterministic server code, with no LLM involved.
- The remaining AI kinds start through `startBackgroundAgentSession()`, which calls the agent-chat route directly and is owned by the core run manager.
- Requests get per-request identity, a server-side claim, and a visible "couldn't start" state.

**Tech Stack:** Clips template (React Router, Drizzle/Postgres), `@agent-native/core` actions + application-state (`compareAndSetAppState`), `startBackgroundAgentSession` from `@agent-native/core/client/agent-chat`, Vitest.

---

## Root causes this plan addresses

| # | Problem | Evidence |
|---|---------|----------|
| 1 | Delivery needs a mounted chat receiver. Recording pages lack one unless the Agent tab is active. | `templates/clips/app/components/library/library-layout.tsx:857` (`enabled={!isRecordingRoute}`); `app/routes/_app.r.$recordingId.tsx:2426` (Agent `TabsContent` without `forceMount`); `app/hooks/use-auto-title.ts:473` (10 s confirm). Introduced by `cfedd4369` / #6207 (2026-09-28). |
| 2 | An undelivered request looks the same as one in progress. It stays `queued` forever and retries silently. | `use-auto-title.ts` `retrySoon()`; `_app.r.$recordingId.tsx:1317` treats `queued` as busy with no deadline. |
| 3 | One app-state slot per recording. A newer request overwrites an older one, and the post-delivery blind DELETE can erase the newer request. | `actions/lib/ai-request-status.ts:42–52`; `use-auto-title.ts:80–87` (`clearRequest`) |
| 4 | There is no cross-tab claim, so every open tab can dispatch the same request. | `use-auto-title.ts:96` (`dispatched` is a per-tab `useRef`) |
| 5 | Silence removal uses an LLM to subtract numbers. | `actions/remove-silences.ts:41–46`. Gaps between `segment.endMs` and the next `startMs` are pure arithmetic. |
| 6 | The browser relay is a hand-rolled background runner. AGENTS.md requires background agents to use core run-manager infrastructure. | `use-auto-title.ts` as a whole |

Already safe: `trim-recording` merges overlapping ranges with a compare-and-set loop (`actions/trim-recording.ts:44–100`), so a duplicate trim of the same range is idempotent. Duplicate dispatch wastes tokens but does not double-cut.

## Non-goals

- Word-level timestamps for filler-word detection. Filler removal stays agent-estimated within segments.
- Changing `generate-workflow`'s request flow. It already has a server-side claim (`actions/reconcile-workflow-generation.ts`). Task 4 reuses that pattern rather than touching it.

---

### Task 1: Hotfix — always mount the recording-page chat receiver

Ship this first, on its own, so users are unblocked while Tasks 2–5 land.

**Files:**
- Modify: `templates/clips/app/routes/_app.r.$recordingId.tsx` (Agent `TabsContent`, ~line 2426)

**Step 1: Add `forceMount` and hide the inactive state**

```tsx
<TabsContent
  forceMount
  value="agent"
  className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto data-[state=inactive]:hidden"
  ref={agentPanelContentRef}
>
```

**Step 2: Check for focus side effects.** Read the `openAgentPanel` / `focusAgentComposer` effects (~lines 230–245 of the #6207 diff, now near the `panel` effects). Confirm that mounting the panel while hidden does not steal focus or scroll. If it does, gate the focus call on `panel === "agent"`.

**Step 3: Verify in the browser**
1. Open a video recording that has a ready transcript. It opens on the Transcript tab.
2. Click **Remove silences**.
3. Expected: within ~3 s the status moves `queued → working`, without opening the Agent tab. Trims appear when the run finishes.
4. Repeat for **Remove filler words**.
5. Record with StartRecording/StopRecording and publish evidence.

**Step 4: Run the existing tests**
Run: `pnpm --filter clips test -- _app.r.\$recordingId`
Expected: pass.

**Step 5: Commit**: `fix(clips): keep the recording agent receiver mounted so queued AI requests start`

> Tradeoff: this mounts `AgentPanel` on every recording view, which has a load cost. Task 3 removes the dependency. Once Task 3 lands, revert `forceMount` if profiling shows a cost.

---

### Task 2: Make "Remove silences" deterministic

**Files:**
- Create: `templates/clips/shared/silence-ranges.ts`
- Create: `templates/clips/shared/silence-ranges.test.ts`
- Create: `templates/clips/actions/lib/apply-trims.ts`
- Modify: `templates/clips/actions/trim-recording.ts` (use `applyTrims`)
- Modify: `templates/clips/actions/remove-silences.ts`
- Modify: `templates/clips/app/routes/_app.r.$recordingId.tsx` (`removeSilences` `onSuccess`)

**Step 1: Create `shared/silence-ranges.ts`**

```ts
import type { TranscriptSegment } from "./transcript-segments";

export interface TrimRange {
  startMs: number;
  endMs: number;
}

export function computeSilenceTrimRanges(
  segments: TranscriptSegment[],
  thresholdMs: number,
  bufferMs = 200,
): TrimRange[] {
  // Mic and system segments overlap in meetings, so gaps are measured on the union.
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const ranges: TrimRange[] = [];
  let speechEnd = -1;
  for (const segment of sorted) {
    if (speechEnd >= 0 && segment.startMs - speechEnd > thresholdMs) {
      const startMs = speechEnd + bufferMs;
      const endMs = segment.startMs - bufferMs;
      if (endMs > startMs) ranges.push({ startMs, endMs });
    }
    speechEnd = Math.max(speechEnd, segment.endMs);
  }
  return ranges;
}
```

**Step 2: Write `shared/silence-ranges.test.ts`.** Cover these cases:
- No segments, which returns `[]`.
- A single gap above the threshold, buffered by 200 ms on each side.
- A gap equal to the threshold, which is not trimmed.
- Overlapping mic and system segments, which must not create a phantom gap.
- Unsorted input.
- A gap smaller than twice the buffer, which is skipped.

Run: `pnpm --filter clips test -- silence-ranges`. Expected: all pass.

**Step 3: Extract `actions/lib/apply-trims.ts`.** Move the compare-and-set loop out of `trim-recording.ts:44–100` into `applyTrims(recordingId, ranges: TrimRange[])`. It must:
- Fold every range through `mergeExcluded` in one read-modify-write.
- Keep the 5-attempt compare-and-set and the `refresh-signal` write.
- Throw the same "concurrent attempts" error.

`trim-recording` then calls `applyTrims(args.recordingId, [{ startMs, endMs }])`. One write for N silences avoids N round-trips and N compare-and-set races.

**Step 4: Rewrite `remove-silences.ts` `run`**
- Keep `assertAccess(..., "editor")` and the transcript-ready check.
- Compute `computeSilenceTrimRanges(parseTranscriptSegments(transcript.segmentsJson), args.thresholdMs)`.
- If there are no ranges, return `{ updated: false, trimCount: 0 }`.
- Otherwise call `applyTrims` and return `{ updated: true, trimCount, removedMs }`.
- Update the action `description` to say it trims directly and the agent should call it, not do the arithmetic itself.
- Remove the `queueAiRequest` call.

**Step 5: Update the UI handler.** In `removeSilences.onSuccess`, replace the queued branch. On `updated`, call `completeAiRequestToast(...)` with the trim count, then refetch the player data. When nothing was found, show a "No long silences found" toast.
- Add the new strings to `app/i18n/en-US.ts` and every configured locale.
- Run `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy`.

**Step 6: Remove `remove-silences` from `DISPATCHABLE_REQUESTS`** in `use-auto-title.ts`. Keep it in `CLIPS_AI_REQUEST_KINDS` so already-stored status records still parse.

**Step 7: Verify.** Run `pnpm --filter clips test` and `pnpm --filter clips typecheck`, both exit 0. Then in the browser, click Remove silences on a recording with gaps. Trims should apply in under 1 s, with no agent run in the Runs tray.

**Step 8: Commit**: `fix(clips): remove silences directly instead of through the agent`

> Known limitation (unchanged from today): segments are caption-sized, and some come from `ESTIMATED_MS_PER_WORD` estimates (`shared/transcript-segments.ts`). Gaps are only as accurate as the transcript timing. The LLM path had exactly the same input.

---

### Task 3: Start agent-backed requests without a mounted chat UI

**Files:**
- Modify: `templates/clips/app/hooks/use-auto-title.ts`
- Check (read only): `packages/core/src/client/background-agent-session.ts`, `packages/core/src/server/agent-chat-plugin.ts`

**Step 1: Confirm the idempotency semantics.** Read `background-agent-session.ts` and the agent-chat route handler. Answer one question: does a second start with the same `operationId` + `threadId` reuse the first run, or start a new one? Record the answer in the PR description.
- If it dedupes, derive both ids deterministically from `recordingId:kind:requestedAt`.
- If not, rely on the Task 4 claim for single-dispatch.

**Step 2: Replace `dispatchAiRequest` for background kinds.** When `request.openInChat !== true`:

```ts
const session = startBackgroundAgentSession({
  message: options.message,
  instructions: options.context,
  scope: { type: "recording", id: request.recordingId },
  ...(options.engine ? { engine: options.engine } : {}),
  ...(options.model ? { model: options.model } : {}),
  usageLabel: `clips:${request.kind}`,
});
await session.accepted; // rejects on timeout or transport failure
```

When `openInChat === true`, keep the existing `sendToAgentChatAndConfirm` path. The user asked to see the run, so a visible receiver is expected.

**Step 3: Settle the status from the run's real outcome.** After `accepted`, watch `session.completion`, then read `session.status()`.
- `completed`: do nothing. The agent already called `update-ai-request-status --status=completed`.
- `errored`, `aborted`, or `unavailable`: call `update-ai-request-status` with `failed` (or `cancelled` for `aborted`), with the `terminalReason` as the message.
- `truncated`: report it as `failed` with "Run stopped before finishing". A truncated run is not a completed one.

This replaces the `agentNative.chatRunning` listener for these kinds. Keep that listener only for `openInChat` and workflow tabs.

**Step 4: Verify in the browser** with Task 1's `forceMount` temporarily reverted.
1. Remove filler words from the Transcript tab. The run starts and the status reaches `completed`.
2. Stop the run from the Runs tray. The status becomes `cancelled`, not stuck on `working`.
3. Record evidence.

**Step 5: Commit**: `fix(clips): start background AI requests as isolated agent sessions`

---

### Task 4: Per-request identity, server-side claim, safe consume

**Files:**
- Modify: `templates/clips/actions/lib/ai-request-status.ts` (`queueAiRequest`)
- Create: `templates/clips/actions/claim-ai-request.ts` (`agentTool: false`)
- Create: `templates/clips/actions/claim-ai-request.test.ts`
- Modify: `templates/clips/app/hooks/use-auto-title.ts` (remove the raw `fetch` DELETE in `clearRequest`)

**Step 1: Refuse to overwrite a live request.** In `queueAiRequest`, read `clips-ai-request-status-<id>`. If it is `queued` or `working` and was updated within the lease window, return `{ queued: false, reason: "busy" }`. Write the new status with `compareAndSetAppState(statusKey, previous, next)` so two concurrent queues cannot both win. Callers (`remove-filler-words`, `regenerate-*`) pass the result through, and the UI shows "Already processing this clip".

**Step 2: Create `claim-ai-request.ts`.** Model it on `reconcile-workflow-generation.ts`, which uses `CLAIM_LEASE_MS = 30_000` and compare-and-set. The schema is `{ recordingId, kind, requestedAt, operation: "claim" | "consume" | "release" }`.
- `claim`: compare-and-set the request payload so `claimedAt` is set only if it is unclaimed or its lease has expired. Return `{ claimed: boolean }`.
- `consume`: compare-and-set the request key to `null` only if `kind` and `requestedAt` still match. This replaces the blind DELETE.
- `release`: clear `claimedAt` after a failed start.

**Step 3: Test `claim-ai-request`.**
- Two claims: exactly one returns `claimed: true`.
- Consume with a stale `requestedAt` leaves the newer request in place.
- An expired lease can be re-claimed.

Run: `pnpm --filter clips test -- claim-ai-request`.

**Step 4: Wire the bridge.** Before starting a session, call `claim`. If it isn't claimed, skip; another tab owns the request. After `accepted`, call `consume`. On start failure, call `release`, then `retrySoon()`. Delete `clearRequest` and its raw `fetch`. AGENTS.md says client code goes through actions, not `/_agent-native/application-state` routes.

**Step 5: Verify.** Open the same recording in two tabs and click Remove filler words once. Exactly one run appears in the Runs tray. Record evidence.

**Step 6: Commit**: `fix(clips): claim and consume AI requests by identity`

---

### Task 5: Make "couldn't start" visible

**Files:**
- Modify: `templates/clips/app/routes/_app.r.$recordingId.tsx` (`aiRequestStatusQ` consumer)
- Modify: `templates/clips/app/i18n/*.ts`

**Step 1: Derive a stalled state.** A status that is `queued` with `updatedAt` more than 45 s old and no claim counts as stalled. Show the progress toast as a failure: "Couldn't start. Retry". Retry re-runs the same mutation. Stop showing the request as busy, so the menu buttons re-enable.

**Step 2: Do not invent success.** The UI never derives `completed` itself. Only `update-ai-request-status` or Task 3's terminal handler writes terminal states.

**Step 3: Add the i18n strings** to every locale, then run both i18n guards.

**Step 4: Verify.** Temporarily make `claim-ai-request` return `claimed: false`. After 45 s the toast shows the retry state, and the buttons re-enable. Revert, then record evidence.

**Step 5: Commit**: `fix(clips): surface AI requests that never started`

---

### Task 6: Instructions, changelog, release hygiene

**Step 1:** Update the request-flow section of the Clips agent instructions (`templates/clips/AGENTS.md`, or the matching skill under `templates/clips/.agents/skills/`):
- `remove-silences` trims directly. The agent should call it rather than computing gaps.
- Filler removal runs as a background session that must finish with `update-ai-request-status`.

Read the `writing-agent-instructions` skill first.

**Step 2:** From `templates/clips`, run: `agent-native changelog add "Remove silences and filler words now start reliably from the recording page" --type fixed`.

**Step 3: Changeset check.** No changeset is needed if only `templates/clips` changed. If Task 3 Step 1 required a core change, add a `.changeset/*.md` for `@agent-native/core`.

**Step 4:** Run `pnpm guards`. Expected: all pass, with nothing SKIPPED.

**Step 5: Commit**: `docs: describe the Clips background request flow`

---

## Final verification checklist

- [ ] Remove silences on the Transcript tab applies trims in under 1 s and starts no agent run.
- [ ] Remove filler words on the Transcript tab, without the Agent tab ever opened (after reverting Task 1's hotfix), reaches `completed`.
- [ ] Two tabs on one recording produce one run.
- [ ] Stopping a run shows `cancelled`, and a truncated run shows `failed`.
- [ ] A request that never starts shows a retry state within 45 s.
- [ ] `pnpm --filter clips test`, `pnpm --filter clips typecheck`, and `pnpm guards` all pass.
- [ ] A browser recording has been published as evidence.

## Open questions

1. Does the agent-chat route dedupe on a repeated `operationId`? This decides whether Task 4's claim is the only single-dispatch guard (Task 3 Step 1).
2. Should leftover `remove-silences` request payloads, queued before Task 2 shipped, be cleaned up by a one-off sweep, or left to expire? Today nothing deletes them. They are tiny and harmless, but `list-ai-requests` will keep returning them.
3. Longer term, should these requests start server-side, from the action itself, so they don't need any open tab? That would need a supported server entry point for app-initiated agent runs. `spawnTask` in `packages/core/src/server/agent-teams.ts` requires a parent run today.
