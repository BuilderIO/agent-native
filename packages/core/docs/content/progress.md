---
title: "Progress"
description: "Live progress signal for long-running agent tasks — start, update, complete"
---

# Progress

Long agent tasks shouldn't hide behind a spinner. `progress_runs` gives the agent a way to announce _"I'm working on this, I'm 45% done, here's the current step"_ — which the UI renders as a floating runs tray with a percent bar.

```ts
import {
  startRun,
  updateRunProgress,
  completeRun,
} from "@agent-native/core/progress";

const run = await startRun({
  owner: "steve@builder.io",
  title: "Triage 128 unread emails",
  step: "Fetching inbox",
});

for (let i = 1; i <= total; i++) {
  await updateRunProgress(run.id, run.owner, {
    percent: Math.round((i / total) * 100),
    step: `Classifying ${i}/${total}`,
  });
}

await completeRun(run.id, run.owner, "succeeded");
```

Separate concern from [notifications](/docs/notifications): notifications fire once (_"X happened"_), progress is continuous state (_"X is 45% done"_). The two compose — `completeRun` followed by `notify(..., severity: "info")` tells the user when the work finishes even if they weren't watching the tray.

## The lifecycle {#lifecycle}

| Status      | Transition                  |
| ----------- | --------------------------- |
| `running`   | Initial — set by `startRun` |
| `succeeded` | Happy-path terminal         |
| `failed`    | Error terminal              |
| `cancelled` | User interrupted            |

Terminal statuses set `completed_at`. The UI tray shows only `running` rows; completed rows stay in the database for `list-runs` queries.

## API {#api}

### `startRun(input)` {#start}

Create a run. Returns the full `AgentRun` with a generated id.

```ts
const run = await startRun({
  owner: "steve@builder.io",
  title: "Ingest 1M rows",
  step: "Opening CSV",
  metadata: { jobId: "abc123", artifactPath: "s3://..." },
});
```

Emits `run.progress.started` on the event bus.

### `updateRunProgress(id, owner, input)` {#update}

Patch any field of a running run. Any omitted field stays unchanged.

```ts
await updateRunProgress(run.id, run.owner, {
  percent: 75,
  step: "Writing to target DB",
});
```

Emits `run.progress.updated` on the event bus. Returns the updated `AgentRun`, or `null` if the run doesn't exist or isn't owned by the caller.

### `completeRun(id, owner, status, extras?)` {#complete}

Transition to a terminal status. `succeeded` implicitly sets `percent=100`.

```ts
await completeRun(run.id, run.owner, "succeeded", {
  step: "All 1M rows ingested",
  metadata: { totalDurationMs: 98_123 },
});
```

Also emits `run.progress.updated` with the terminal status.

### Listing {#list}

```ts
import { listRuns, getRun, deleteRun } from "@agent-native/core/progress";

const active = await listRuns("steve@builder.io", { activeOnly: true });
const run = await getRun("run-id", "steve@builder.io");
await deleteRun("run-id", "steve@builder.io");
```

## HTTP API {#http}

Mounted at `/_agent-native/runs/*` by the core-routes plugin. **Read-only over HTTP** — writes go through the agent tools since the agent is the canonical writer. All routes are owner-scoped.

| Method   | Path                              |
| -------- | --------------------------------- |
| `GET`    | `/_agent-native/runs?active=true` |
| `GET`    | `/_agent-native/runs/:id`         |
| `DELETE` | `/_agent-native/runs/:id`         |

## UI component {#ui}

```tsx
import { RunsTray } from "@agent-native/core/client/progress";

export function HeaderBar() {
  return (
    <header className="flex items-center gap-2">
      {/* … */}
      <RunsTray />
    </header>
  );
}
```

Inline header widget — mount it next to the notifications bell. Shows a spinner icon + count badge when runs are active; click opens a dropdown with one live percent bar per run. Hides the trigger entirely when no active runs. Polls `/_agent-native/runs?active=true` every `pollMs` (default 3 s). Uses shadcn semantic tokens, adapts to light and dark themes.

## Agent tools {#agent-tools}

Four native tools are registered in every template:

| Tool                  | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `start-run`           | Call at the top of a long task. Returns a runId.                |
| `update-run-progress` | Call periodically during the task with `percent` and/or `step`. |
| `complete-run`        | Terminal — one of `succeeded`, `failed`, `cancelled`.           |
| `list-runs`           | Inspect recent runs (filter by `active=true`).                  |

### When to start a run {#when-to-start}

- Use for anything > ~5 seconds. A spinner with no context feels frozen.
- Update at natural checkpoints, not every iteration. Every 5–10% is plenty.
- **Always** call `complete-run`, including in error paths. An orphan `running` row is worse than no row.
- Pair with `notify` on completion so the user sees the outcome when they're not actively watching the tray.

## Event bus {#event-bus}

Two events emit on the [event bus](/docs/automations#event-bus):

| Event                  | Payload                            |
| ---------------------- | ---------------------------------- |
| `run.progress.started` | `{ runId, title, step? }`          |
| `run.progress.updated` | `{ runId, percent, step, status }` |

[Automations](/docs/automations) can subscribe to these — for example, _"if a run takes longer than 5 minutes, notify me"_:

```yaml
---
triggerType: event
event: run.progress.updated
condition: "status is running and (now - started) > 5 minutes"
mode: agentic
---
Notify me that run {{runId}} has been running for a long time.
```

## How it works {#internals}

- **Owner scoping** — every row has an `owner` column; every query filters on it. Users see only their own runs.
- **Poll integration** — every mutation calls `recordChange()` so templates using [`useDbSync`](/docs/client) auto-invalidate without any extra wiring.
- **Table name** — the framework also has an `agent_runs` table for internal agent-chat turn lifecycle tracking. The progress primitive uses `progress_runs` to keep the two concerns separate.
- **Percent clamping** — values are clamped to `[0, 100]` and rounded to an integer on write.

## What's next

- [**Notifications**](/docs/notifications) — pair with `complete-run` to tell the user when work finishes
- [**Automations**](/docs/automations) — watchdog slow runs via `run.progress.updated`
- [**Client**](/docs/client) — `useDbSync` for real-time cache invalidation
