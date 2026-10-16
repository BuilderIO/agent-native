# Assets — Agent Guide

Assets is an agent-native asset library/generator; UI and agent share actions.

## Skills

Search skills with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/creative-context/SKILL.md`, `.agents/skills/library-management/SKILL.md`, `.agents/skills/asset-generation/SKILL.md`, `.agents/skills/image-generation/SKILL.md`, `.agents/skills/logo-composite/SKILL.md`, `.agents/skills/assets-navigation/SKILL.md`, `.agents/skills/agent-engines/SKILL.md`, `.agents/skills/a2a-assets/SKILL.md`, `.agents/skills/inline-embeds/SKILL.md`, `.agents/skills/notifications/SKILL.md`, `.agents/skills/progress/SKILL.md`. Shared: `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`. Source examples: `pnpm action source-search --query "<pattern>"` or `pnpm action source-search --path <path>`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for asset lifecycle, generation, libraries, uploads, embeds, notifications, progress, sharing, and collaboration. Respect access checks; use the configured generation/engine path, not ad hoc provider calls.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, private/customer data, or credential-looking literals.
- Keep large file/blob payloads in configured storage, not SQL, `application_state`, `settings`, or `resources`; persist URLs, ids, or handles only. Preserve asset provenance and metadata.
- Use `view-screen` when the active library, selected asset, picker, generation, or embed target is unclear.
- Image work is template-first: follow the `creative-context` reuse ladder, check `list-templates`, then generate with a matching `templateId`. Templates are global or tied to one brand kit; only associated templates can pin images, skeleton plates, or a canonical logo.
- When a `template` is tagged, use its `<tagged-templates>` brief and pass `templateId`, not repeated saved settings. `*-generation-preset` actions are deprecated aliases.
- Keep previews lightweight and fetch full details through actions. Kit viewers may generate drafts; saving to the kit requires editor access.

## Application state

- `navigation` tracks library, asset, generation, picker, embed, and selection. Library: `{ view: "library", selection: "all" | libraryId, tab, scope, folderId, search }`; picker: `{ view: "picker", mediaType, libraryId, query, prompt, aspectRatio }`; gallery: `{ view: "templates" }`; editor: `{ view: "template", templateId }`. Legacy preset navigation still resolves.
- `creative-context`: `{ contextMode, selectedContextId, currentPackId, pinnedPackId }`; respect `contextMode: "off"`.
- `asset-variants` is the shared live generation tray; use `generate-image` / `generate-image-batch` for candidates. `imageGenerationModel` is the composer default when `model` is omitted.

## Key actions

Use `tool-search` for uncommon actions.

| Actions | Purpose |
| --- | --- |
| `navigate`, `view-screen` | Move or inspect the UI |
| `list-libraries`, `match-library`, `duplicate-library` | Find or copy a kit |
| `list-assets`, `search-assets`, `import-asset-from-url`, `import-style-from-url`, `export-asset` | Browse, ingest, or export assets |
| `list-templates`, `get-template`, `create-template`, `update-template`, `associate-template`, `duplicate-template`, `set-canonical-logo` | Manage recipes and logos |
| `generate-image`, `generate-image-batch`, `generate-video`, `refresh-generation-run` | Generate candidates; refresh video status |
| `refine-image`, `edit-image`, `restyle-image` | Iterate on an asset |
| `generate-asset`, `open-asset-picker`, `create-generation-session`, `manage-context-membership` | Hand off generation, browse, or submit to Creative Context |

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
