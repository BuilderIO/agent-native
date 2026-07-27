---
name: workspace-conventions
description: >-
  Shared conventions for a multi-app Agent Native workspace: finding
  version-matched framework docs and source, shared vs app-owned code, file and
  blob storage, env and secrets, agent scratch files, and Dispatch Resources.
  Use when working across workspace apps, storing files or credentials, or
  looking up framework APIs.
---

# Workspace Conventions

The long-form detail behind the workspace `AGENTS.md` core rules. Read this
before adding shared code, storing files or secrets, creating workspace
resources, or looking up framework APIs.

## Framework Docs Lookup

Version-matched Agent Native docs ship with `@agent-native/core` in
`node_modules/@agent-native/core/docs`. A source-only corpus of core and
first-party template patterns ships in `node_modules/@agent-native/core/corpus`.

- From an app directory, use `pnpm action docs-search --query "<topic>"`,
  `pnpm action docs-search --slug <slug>`, or `pnpm action docs-search --list`.
  Use `pnpm action source-search --query "<pattern>"` or
  `pnpm action source-search --path <path>` when source examples matter.
- If the action runner is unavailable, read
  `node_modules/@agent-native/core/docs/AGENTS.md` and search
  `node_modules/@agent-native/core/docs/content/` directly with `rg`. Search
  `node_modules/@agent-native/core/corpus/` for source examples.
- For advanced workspace features, start with `workspace`, `multi-app-workspace`,
  `a2a-protocol`, `pure-agent-apps`, `automations`, `recurring-jobs`,
  `external-agents`, `mcp-protocol`, `feature-flags`, `sharing`, and `security`.

Use package docs for framework APIs, the package corpus for reusable
framework/template patterns, and this `AGENTS.md` plus `.agents/skills/` for
workspace-specific conventions.
Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Read
`customizing-agent-native` before adapting shared UI. Use the supported
ladder: configure → compose → eject the smallest unit → propose a shared seam.
Preview before `--apply`, commit `agent-native.ejections.json`, and never edit
`node_modules` or eject protected runtime contracts.

## Shared Conventions

- All AI/LLM behavior goes through the app's agent chat. UI and server code
  must not call model providers, AI SDK `generateText()` / `streamText()`, or
  other inline LLM APIs directly. Use `sendToAgentChat()` for local app-agent
  work, including hidden `context` and `submit: false` prefill/review flows.
  Only use `useAgentChatContext`, `setAgentChatContextItem`,
  `listAgentChatContext`, `removeAgentChatContextItem`, and
  `clearAgentChatContext` when UI needs two-way sync with staged context chips.
  Read `.agents/skills/delegate-to-agent/SKILL.md` before building agent-driven
  UI or "AI" features.
- Put shared code in `packages/shared` only when multiple apps need it.
- Keep app-specific screens, actions, state, and skills inside `apps/<app>`.
- SQL is for structured records, metadata, references, and searchable text. Store
  large files/blob payloads (base64, `data:` URLs, images, video/audio, PDFs,
  ZIPs, screenshots, thumbnails, session replay chunks) in configured file/blob
  storage and persist only URLs, ids, or handles.
- Store shared runtime configuration in the workspace root `.env`; use
  `apps/<app>/.env` only for app-specific overrides. Never hardcode API keys,
  tokens, webhook URLs, signing secrets, private Builder/internal data, customer
  data, or credential-looking literals in source, docs, prompts, fixtures,
  application state, action responses, or generated app content. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Prefer framework defaults until the workspace has a real custom rule,
  component, plugin, action, or skill to share.
- Keep the Workspace files view for user-authored or user-requested resources.
  Agents may create hidden `agent_scratch` resources for temporary working
  notes, scripts, task plans, or intermediate outputs, but should promote them
  to normal workspace visibility only when the user explicitly asks to keep or
  manage the file.
- Runtime-editable global resources can be managed from Dispatch Resources.
  Use `AGENTS.md` or `instructions/<slug>.md` for always-on guardrails,
  `skills/<slug>/SKILL.md` for workspace skills, `context/<slug>.md` for
  personas/positioning/messaging/company facts/brand guidelines, and
  `agents/<slug>.md` for custom agent profiles. Scope them to All apps when
  every workspace app should inherit them. All-app resources are inherited at
  runtime; do not copy or sync them into individual apps.

## Related Skills

- **adding-workspace-apps** — Creating and mounting a new app under `apps/`.
- **agent-native-docs** — The full docs and source-corpus lookup workflow.
- **agent-native-toolkit** — Inventory of shared workspace and agent UI.
- **customizing-agent-native** — The configure → compose → eject ladder.
- **delegate-to-agent** — Routing every AI feature through the agent chat.
- **secrets** — Registering API keys and service credentials.
- **storing-data** — Where structured data and large payloads belong.
