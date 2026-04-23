---
name: progress
description: >-
  Report live progress from long-running agent tasks. Use when a task takes
  more than a few seconds, so the user can watch status in the runs tray
  instead of staring at a spinner.
---

# Progress

## Overview

`progress_runs` is the framework's "what is the agent doing right now" primitive. The agent starts a run at the top of a long task, updates it as work proceeds, and completes it with a terminal status. The UI renders active runs in a header-bar widget with a percent bar, current step, and spinner/check/X — live visibility into work that would otherwise be opaque.

Separate concern from `notifications`:

| | Notifications | Progress |
|---|---|---|
| Shape | One-shot event — "X happened" | Continuous state — "X is 45% done" |
| UI surface | Bell + toast | Runs tray with percent bar |
| Lifecycle | Dismissable (read/unread) | Running → terminal (succeeded/failed/cancelled) |

Common pattern: on completion, emit a `notify()` so the user sees the outcome when they're not actively watching the tray.

## Available Tools

| Tool | Purpose |
|---|---|
| `start-run` | Mark the start of a long task. Returns a runId. |
| `update-run-progress` | Update percent and/or current step. Call frequently. |
| `complete-run` | Mark terminal status: `succeeded`, `failed`, `cancelled`. |
| `list-runs` | List recent runs (all or `--active=true`). |

## Canonical Flow

```
start-run --title "Triage 128 unread emails" --step "Fetching inbox"
  → runId=abc

update-run-progress --runId=abc --percent=25 --step="Classifying 32/128"
update-run-progress --runId=abc --percent=75 --step="Drafting replies 97/128"

complete-run --runId=abc --status=succeeded
notify --severity=info --title="Triage done" --body="12 archived, 6 drafts ready to review"
```

## Best Practices

- **Start a run for anything > ~5 seconds.** Users want feedback; a spinner with no context feels frozen.
- **Update at natural checkpoints**, not every iteration. Every 5–10% is enough for most UIs.
- **Always call `complete-run`** at the end — including the error path. An orphaned `running` row is worse than no row.
- **Pair with `notify`** on completion. The tray tells users what's *running*; notifications tell them what *finished*.
- **Use `metadataJson`** on `start-run` to pass a link back to the produced artifact (thread id, document path), so the UI can deep-link from the runs tray.

## Runs API

Mounted at `/_agent-native/runs/*` by `core-routes-plugin`. **Read-only** over HTTP — writes flow through the agent tools:

| Method | Route |
|---|---|
| `GET`    | `/_agent-native/runs?active=true&limit=50` |
| `GET`    | `/_agent-native/runs/:id` |
| `DELETE` | `/_agent-native/runs/:id` |

## UI Surface

Ships as `<RunsTray />` at `@agent-native/core/client/progress`:

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

Inline header widget — mount next to the notifications bell. Shows a spinner icon + count badge when runs are active; click opens a dropdown with a live percent bar per run. Hides the trigger entirely when no active runs. Polls `active=true` every `pollMs` (default 3s).

## Event Bus Integration

Two events emit on the bus so automations can react:

- `run.progress.started` — `{ runId, title, step? }`
- `run.progress.updated` — `{ runId, percent, step, status }`

Example automation: *"when a run takes longer than 5 minutes, notify me."*

## Related Skills

- `notifications` — fire one when a run finishes so the user sees the outcome.
- `automations` — subscribe to `run.progress.updated` to build watchdogs on slow runs.
- `delegate-to-agent` — if you're delegating a long task, start a run on the delegator side so the caller has visibility.
