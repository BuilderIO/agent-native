---
name: context-xray
description: >-
  Inspect and manage the live agent context window with Context X-Ray. Use when
  context is getting large, the user asks what is in context, or stale tool
  results/files should be pinned, evicted, restored, or reported by an external
  host.
metadata:
  internal: true
---

# Context X-Ray

Context X-Ray is the framework's context garbage-collection surface. It shows
the current thread's model-bound context as content-derived segments with token
counts, then lets the user or agent pin, evict, or restore individual segments.

## Actions

| Action | When to use |
| --- | --- |
| `context-manifest-get` | Read the current manifest for a thread. Returns token totals, segment status, source, and whether changes are enforceable. |
| `context-pin` | Preserve a segment across future compaction/model calls. Use for task specs, acceptance criteria, user constraints, and other durable context. |
| `context-evict` | Exclude a stale or irrelevant segment from future model calls. Eviction is reversible and never deletes chat history. |
| `context-restore` | Undo a pin, evict, or summarize directive for a segment. |
| `context-report` | External hosts can report their visible context inventory. These manifests are advisory unless Agent-Native owns the emitted content. |

## Rules

- Never evict or summarize protected segments. The manifest marks active-turn
  user/tool/thinking context as `protected`.
- Prefer pinning the user's task, requirements, and decisions before evicting
  large stale tool results.
- Eviction excludes content from future model calls; it does not delete the
  canonical transcript or files.
- In external/advisory mode, be honest: recorded directives are intent for the
  host except for Agent-Native-originated content we can actually withhold.
- If token counts are estimated, describe reclaim as approximate.

## Typical Flow

1. Call `context-manifest-get` with the active `threadId`.
2. Sort segments by `tokenCount` and inspect large stale `Tool results` or
   `Files read` entries.
3. Call `context-pin` for essential specs or user instructions.
4. Call `context-evict` for large irrelevant segments.
5. Offer `context-restore` if the user wants undo.
