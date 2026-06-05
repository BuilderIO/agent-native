---
name: adding-a-feature
description: >-
  The four-area checklist every new feature in this app must complete. Use
  when adding any feature, integration, or capability to keep the agent and
  UI in parity.
---

# Adding a Feature — The Four-Area Checklist

## Rule

Every new feature MUST update all four areas. Skipping any one breaks the agent-native contract — the agent and UI must always be equal partners.

## Why

Agent-native apps are defined by parity: everything the UI can do, the agent can do, and vice versa. A feature that only has UI is invisible to the agent. A feature that only has actions is invisible to the user. A feature without app-state sync means the agent is blind to what the user is doing. And **a feature without auto-refresh wiring means the agent's writes are silently invisible until the user manually reloads** — that breaks the framework's #1 promise.

## The Checklist

### 1. UI Component

Build the user-facing interface — a page, component, dialog, or route. Use `useActionQuery` and `useActionMutation` from `@agent-native/core/client` for data fetching and mutations. You rarely need custom `/api/` routes.

**Auto-refresh on agent writes is non-negotiable** — when the agent mutates the data this UI shows, the UI must reflect the change without a manual refresh. Two paths, pick the right one:

- **`useActionQuery` (preferred)** — automatically covered. The framework's `useDbSync` invalidates `["action"]` on every change event, so every `useActionQuery` hook refetches when the agent runs an action. No extra wiring required.

- **Raw `useQuery` with a custom key** — needs explicit wiring. Fold `useChangeVersions([<source>, "action"])` from `@agent-native/core/client` into the `queryKey` and set `placeholderData: (prev) => prev`. The `"action"` source is the reliable signal — the agent runner emits it after every successful tool call. The resource-specific source (e.g. `"settings"`, `"app-state"`) is bonus. Without this wiring, agent writes will be invisible until manual refresh.

  ```tsx
  import { useChangeVersions } from "@agent-native/core/client";
  import { useQuery } from "@tanstack/react-query";

  function useItem(id: string) {
    const v = useChangeVersions(["items", "action"]);
    return useQuery({
      queryKey: ["item", id, v],
      queryFn: () => fetchItem(id),
      placeholderData: (prev) => prev, // no flicker on refetch
    });
  }
  ```

  See the `real-time-sync` skill for the full pattern and source catalog.

### 2. Action

Create an action in `actions/` using `defineAction`. This serves double duty: the agent calls it as a tool, and the framework auto-exposes it as an HTTP endpoint at `/_agent-native/actions/:name` for the UI to call. Set `http: { method: "GET" }` for read actions, leave default for writes, or set `http: false` for agent-only actions like `navigate` and `view-screen`.

### 3. Skills / Instructions

Update `AGENTS.md` (the per-app guide) and/or create a skill in `.agents/skills/` if the feature introduces patterns the agent needs to know. At minimum, add the new actions to the action table in the template's `AGENTS.md`.

### 4. Application State Sync

Expose navigation and selection state so the agent knows what the user is looking at. Write to the `navigation` app-state key on route changes. Update the `view-screen` action to fetch relevant data for the new feature. Add a `navigate` command if the agent needs to open the new view.

## Anti-Patterns

- **UI without actions** — The user can create things but the agent cannot. Breaks parity.
- **Actions without UI** — The agent can do something the user cannot. Less common but still breaks parity.
- **Mutations without auto-refresh wiring** — The agent says "done!" but the screen doesn't change until the user hits reload. This is the most common silent regression. If you used `useActionQuery` you're covered; if you used raw `useQuery`, fold `useChangeVersions` into the key. Always test by asking the agent to mutate the data and watching the UI without refreshing.

## Verification

For every new feature, manually verify:

1. Can the user perform the operation from the UI?
2. Can the agent perform the operation via an action (`pnpm action <name>`)?
3. When the agent runs the action, **does the UI update within a second or two without a manual refresh**? If not, your query is missing `useActionQuery` or `useChangeVersions` wiring — go back to step 1.
4. Does `view-screen` return the new feature's state when the user is on that page?
