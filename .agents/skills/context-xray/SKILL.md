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
| `context-preview-get` | Compose the would-be system context for the current user/org/app without a live thread. Returns labeled system sections with provenance, governance tier, token counts, and bounded previews. Backs the Agent page Context tab. |
| `context-pin` | Preserve a segment across future compaction/model calls. Use for task specs, acceptance criteria, user constraints, and other durable context. |
| `context-evict` | Exclude a stale or irrelevant segment from future model calls. Eviction is reversible and never deletes chat history. |
| `context-restore` | Undo a pin, evict, or summarize directive for a segment. |
| `context-report` | External hosts can report their visible context inventory. These manifests are advisory unless Agent-Native owns the emitted content. |

## System Sections

Manifests now cover the system-prompt half of context, not just conversation
segments. Each system section carries a `provenance` label (framework-core,
actions-prompt, template, enterprise-workspace-core, sql-workspace,
legacy-app-default, organization, personal, memory, db-schema, tools,
model-overlay, runtime-context) and a `governance` tier:

- `required` — framework/enterprise policy; can never be altered by the user.
- `inherited` — template/org/workspace instructions; managed elsewhere,
  visible here.
- `user` — personal instructions and memory; editable through Files.

System sections are display-only provenance: they cannot be pinned, evicted,
or summarized. The persisted manifest stores source refs, scope, content
hashes, token counts, and bounded previews (~200 chars) — never raw prompt
bodies; full content stays behind the resource/access model. The in-chat
X-Ray panel groups these under "System", and the Agent page Context tab
renders the full breakdown (via `context-preview-get`) with a
system-vs-conversation split meter. Manifests are the latest snapshot per
thread; there is no per-iteration history.

## Rules

- Never evict or summarize protected segments. The manifest marks active-turn
  user/tool/thinking context as `protected`.
- System sections are never evictable; required/inherited tiers are locked by
  design — do not present controls that imply otherwise.
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
