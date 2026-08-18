---
name: plan-source-sync
description: >-
  The MDX source surface for plans: export, import, patch by semantic ID, DB-free
  local plan folders, `comments.json` sidecars, promotion into a repo, and the
  Desktop folder bridge. Use when a plan must round-trip to or from repo files.
---

# Plan Source Sync

## Source Surface

Runtime plan content is normalized JSON in SQL. MDX is the source-control
surface: `plan.mdx` for frontmatter plus markdown/document blocks,
`prototype.mdx` for optional Prototype/PrototypeScreen/PrototypeTransition
markup, `canvas.mdx` for optional DesignBoard/Section/Artboard/Screen/
Annotation/Connector markup, optional `assets/`, and optional
`.plan-state.json`.

## Rules

- Use `export-visual-plan` or `read-visual-plan-source` when a user or external
  agent wants plan files to check into a repo.
- Use `get-local-plan-folder` to read a DB-free local MDX folder from
  `PLAN_LOCAL_DIR` or from a repo-relative `path`, and
  `update-local-plan-folder` to apply structured `contentPatches` back to that
  same folder. Pass `path` whenever the user is viewing a
  `/local-plans/:slug?path=...` URL. These local-folder actions do not read or
  write SQL.
- Use `update-local-plan-comments` to add, reply to, resolve, or delete review
  comments on a local plan. They persist to a `comments.json` sidecar beside
  `plan.mdx` (committed with the plan, no SQL), are always addressed to the
  agent (`resolutionTarget: "agent"`), and are surfaced by `get-local-plan-folder`.
  Local comments are a one-way handoff to the coding agent — delivery is the
  composer's "Send to agent" copy-to-clipboard, not notifications or sharing.
  In bridge mode the read-only bridge serves no comments, so the colocated
  folder's `comments.json` is merged in for display and persistence.
- Use `promote-local-plan-folder` when a temporary local plan should be saved
  into the repo. Its default target is `apps.plan.roots[0].path/<slug>` from
  `agent-native.json`, falling back to `plans/<slug>`.
- Commit `.plan-state.json` with repo-backed plan folders when present. It is
  source metadata for stable bare-Markdown block IDs, not a disposable preview
  cache.
- Use `import-visual-plan-source` to create or replace a plan from an MDX folder.
- Use `patch-visual-plan-source` for small source edits by stable semantic IDs.
  It patches the MDX AST, runs formatting, parses back to normalized JSON, and
  persists the runtime model. Prefer this over regenerating a whole plan when the
  requested change is a few lines, one annotation, one artboard, or one
  wireframe node.
- `replace-file` is a destructive source operation. Use it only when targeted
  source patches cannot express the edit, after a fresh `get-visual-plan`, and
  pass that read's `plan.updatedAt` as `expectedUpdatedAt`. Re-read the plan
  after the patch and verify that unrelated MDX files and visual surfaces were
  preserved.
- In Agent Native Desktop, the Plan menu can link a user-chosen local folder for
  the current plan, write the exported MDX files to it, import local edits back
  through `import-visual-plan-source`, and optionally auto-export whenever the
  hosted plan changes. This is a native desktop bridge; it does not require a
  cloned Plan app or CLI process.
- Do not fork the vocabulary. MDX components must map to the same runtime terms:
  `DesignBoard`, `Section`, `Artboard`, `Screen`, `Annotation`, `Connector`, and
  the wireframe kit primitives from `shared/plan-content.ts`.

## Related Skills

- **plan-hosted-writes** — the revision guard `replace-file` depends on.
- **plan-browser-editing** — how local folders autosave from the browser.
- **visualize-repo** — repo-native visual docs built on local plan folders.
