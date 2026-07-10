---
name: ingestion-and-connectors
description: >-
  Create, sync, and diagnose Brain sources across all providers (manual,
  generic, clips, slack, granola, github) — health states, sync scheduling,
  and credential resolution. Use when adding a source, running or debugging a
  sync, or the user asks why a source is stale, erroring, or not importing.
---

# Ingestion and Connectors

For Slack-specific rollout steps (channel allow-lists, pilot runs, scope
checklist), read `brain-runbook` instead — this skill covers the
provider-agnostic source lifecycle.

## Source Providers

`create-source` accepts exactly `manual`, `generic`, `clips`, `slack`,
`granola`, or `github` (`sourceProviderSchema`). There is no arbitrary/custom
provider string — a generic webhook-fed source uses `provider: "generic"`
with a `sourceKey` + minted `ingestToken`, not a made-up provider id.

```bash
pnpm --filter brain action create-source \
  --title "Support call transcripts" \
  --provider generic \
  --sourceKey support-calls \
  --visibility org
```

`create-source` returns `ingestToken` in the response **once** — it is stored
only as a SHA-256 hash (`ingestTokenHash`) on the source row, so it cannot be
retrieved again later. Surface it to the user immediately (e.g. for wiring
into an external system's webhook config) rather than assuming you can read
it back with `get-source`.

## Source Health States

`get-brain-health` (`readBrainHealth` in `server/lib/brain-health.ts`) is the
single action to check before telling a user "your source is broken" or
"nothing has synced yet." Each source gets one deterministic `health` value:

| Health | Meaning |
| --- | --- |
| `error` | Source `status === "error"`, has `lastError`, or its latest sync run failed. |
| `paused` | Source `status` is `paused` or `archived`. |
| `needs_setup` | Slack source with no configured channel allow-list yet (`channelIds`/`channels`/`allowedChannels` all empty). |
| `needs_sync` | Auto-sync-eligible provider (slack/granola/github) that has never completed a sync (`lastSyncedAt` is null). |
| `stale` | Past its computed `nextSyncAt` by more than a 15-minute grace window. |
| `healthy` | None of the above. |

`get-brain-health` also reports `distillationQueue` counts (`pending`,
`failed`, `stale` — a `processing` row untouched for 15+ minutes counts as
stale), `proposals.pending`, `sources.attention` (every non-healthy source),
and ordered `setup.nextSteps`. Read this before diagnosing a "why isn't X in
Brain yet" question — it is cheaper and more reliable than inspecting
individual sources by hand.

## Running a Sync

- `sync-source --sourceId=<id>` runs one source's connector immediately
  (requires `editor` access on that source). Slack scans only its allow-listed
  channels; Granola polls accessible notes; GitHub imports approved
  repository issues/PRs.
- `sync-due-sources` sweeps every accessible source whose `nextSyncAt` has
  passed. Prefer this for "catch everything up" requests instead of listing
  sources and calling `sync-source` in a loop.
- Auto-sync only applies to `slack`, `granola`, and `github` sources, and only
  when the source's own config doesn't explicitly set `autoSync: false`
  (`sourceAutoSync` in `brain-health.ts`). `manual`, `generic`, and `clips`
  sources are push/import-driven, not polled — there's no `nextSyncAt` to
  wait on for those.

## Credential Resolution Order

Every provider-backed source resolves its credential in this order (never
skip ahead or ask for a duplicate token if an earlier tier already has one):

1. Granted `workspace_connections` / `workspace_connection_grants` for
   `appId=brain` — a shared credential another app or Dispatch already
   connected and granted to Brain.
2. Backward-compatible Brain-local SQL credentials (legacy, pre-workspace-grant
   sources).
3. Registered vault secrets scoped to the same user/org/workspace.

Brain source credentials **do not** fall back to raw deploy-level environment
variables — `.env`/`.env.local` alone will not satisfy a source's credential
check. `list-connection-providers` reports per-provider readiness
(`connected`, `granted`, `needs_grant`, `not_connected`) plus credential
health, so check that before telling a user to paste a new token — if a
provider shows `needs_grant`, the fix is granting Brain access to the existing
connection, not creating a new one.

## Editing And Removing Sources

- `update-source` edits title, config, or visibility on an existing source.
- `delete-source` is a hard delete — there's no soft-archive alternative
  exposed as an action; setting `status: "paused"` via `update-source` is the
  reversible way to stop a source without losing its captures.
- `list-sources --provider=<p> --includeArchived=<bool>` is scoped by
  `accessFilter` — sharing/visibility rules apply the same way they do for
  knowledge and proposals.

## Related Skills

- `brain` — distillation, retrieval, and publish-tier mechanics once a
  capture exists.
- `brain-runbook` — Slack rollout steps, distillation worker internals,
  scheduled sync cron wiring, demo/eval seeding, and the generic ingest
  webhook payload shape.
- `sharing` — the `accessFilter`/`assertAccess` pattern used throughout source
  and capture reads.
