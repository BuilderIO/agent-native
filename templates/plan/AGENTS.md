# Agent-Native Plan — Agent Guide

Agent-Native Plan is a local-first structured visual plan mode for coding
agents: it turns agent plans into editable rich blocks, diagrams, wireframes,
prototype options, annotations, and comments a person reviews before code
changes happen.

## Skills

The plan skills own all planning behavior. Read the matching SKILL.md before
generating or editing a plan.

- `visual-plan` — `/visual-plan`, the canonical slash command for any rich plan;
  also governs `create-ui-plan`, `create-prototype-plan`, `create-plan-design`,
  and `create-visual-questions`.
- `visual-recap` — `/visual-recap`, visual code-review recaps for PRs, commits,
  branches, and git diffs.
- `plan-authoring-flow` — command/action routing and design fidelity.
- `plan-hosted-writes` — session, revision guard, post-write verify.
- `plan-comments-and-feedback` — feedback fields, anchors, replies, deletion.
- `plan-browser-editing` — inline prose, design element, branding edits.
- `plan-source-sync` — plan MDX export/import/patch and local plan folders.
- `plan-version-history` — snapshots and restore.
- `plan-local-codebase-chat` — questions about a linked local codebase.
- `plan-review-recaps` — recap comparison blocks and PR recap CI.
- `plan-events` — plan lifecycle events and automations.

## Core Rules

- Follow the root framework rules: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- Default to structured visual artifacts over long Markdown. Text is one block
  type, not the whole plan.
- Before edits, read pending feedback with `get-plan-feedback`.
- Read `plan-hosted-writes` before any hosted plan write: writes need a real
  user session, destructive writes need a fresh `expectedUpdatedAt`, and every
  write must be verified by a re-read before you claim success.
- Runtime plan content is normalized JSON in SQL; MDX (`plan.mdx`,
  `canvas.mdx`, `prototype.mdx`) is the source-control surface — see
  `plan-source-sync`.
- New canvas wireframes use `<Screen html={...} />` semantic HTML; nested
  kit-tree nodes are legacy only — see `plan-authoring-flow`.

## Application State

- `navigation.view` is `chat`, `plans`, `plan`, `extensions`, or `team`.
- `navigation.planId` identifies the active visual plan when present.
- `local-codebase` holds the folder the Ask Plan picker linked plus personal
  resource paths for its index, file tree, and snapshots — see
  `plan-local-codebase-chat`.
- `navigate` moves the UI to the plan list or a specific visual plan.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen`, `navigate` | Read the screen; move the UI |
| `list-visual-plans`, `get-visual-plan`, `show-visual-plan` | List, read, render plans |
| `create-visual-plan`, `create-ui-plan`, `create-prototype-plan`, `create-plan-design`, `create-visual-questions` | Create a plan per mode; one call per plan |
| `create-visual-recap`, `search-pr-recaps` | Create and find recaps |
| `visualize-plan`, `convert-visual-plan-to-prototype` | Convert pasted plans; legacy mock→prototype |
| `update-visual-plan` | Patch blocks, screens, fidelity, comments, status |
| `get-plan-blocks`, `list-plan-components`, `visual-answer` | Block schemas, components, visual answers |
| `publish-visual-plan`, `export-visual-plan` | Share hosted; export HTML/MD/JSON/MDX |
| `get-plan-access-status`, `request-plan-access` | Check or request access |
| `get-plan-feedback`, `consume-plan-feedback`, `resolve-plan-comment`, `reply-to-plan-comment`, `delete-plan-comment` | Read, consume, resolve, reply, delete feedback |
| `list-plan-versions`, `get-plan-version`, `restore-plan-version` | List, inspect, restore snapshots |
| `read-visual-plan-source`, `import-visual-plan-source`, `patch-visual-plan-source` | Read, replace, patch MDX source |
| `get-local-plan-folder`, `update-local-plan-folder`, `update-local-plan-comments`, `promote-local-plan-folder`, `validate-local-plan-source` | DB-free local plan folders |
| `delete-visual-plan`, `report-visual-plan` | Delete/restore; report abuse |

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
