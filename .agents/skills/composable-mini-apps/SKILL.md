---
name: composable-mini-apps
description: >-
  Build many focused workspace apps that compose through agent discovery and
  A2A. Use when designing headless mini-apps or cross-app workflows.
scope: dev
---

# Composable Mini-Apps

## Rule

Prefer many one-job apps in a workspace over one oversized app. A headless app
can own a provider, dataset, workflow, or specialist action surface without a
full UI; the main agent composes those apps through discovery and A2A.

## Shape

- Give each mini-app one clear job, a concise `package.json` description, and
  action names that describe the job it owns.
- Keep provider credentials and upstream API details in the app that owns that
  provider or workflow. Other apps should delegate to it instead of copying its
  integration code.
- Use a tiny status/config screen only when users need to inspect state. A
  pure headless app is fine when its job is invoked by agents, automations, or
  sibling apps.
- If two workflows only share a helper, put the helper in `packages/shared`;
  keep the workflow actions in separate apps.

## Discovery And Invocation

The main agent should discover available siblings before assuming capability:

- Runtime agents receive an `<available-apps>` block built from
  `discoverAgents()`. Workspace siblings are layered in by
  `discoverWorkspaceAgents()`.
- UI shells, headless surfaces, and scripts can read the same registry through
  `GET /_agent-native/agents?selfAppId=<app-id>`.
- Code or CLI callers should use the first-class A2A invocation path
  (`invokeAgent()` / `agent-native invoke`) when they need to call an app by
  id, name, or URL.
- In the agent loop, use `call-agent` with the sibling app id when another app
  owns the work or data. Never call the current app through `call-agent`; use
  local actions instead.

Send narrow prompts to siblings: name the exact question, relevant ids, date
ranges, and expected output shape. Preserve returned ids and URLs verbatim.

## Artifact Handoff

Mini-apps should hand off compact artifacts, not giant pasted transcripts or
provider dumps. When a mini-app creates something another app may use, return
or store an artifact with:

- `artifactType` - what kind of output this is, such as `deal-set`,
  `call-evidence`, `brief`, `dashboard`, or `report`.
- `artifactId` - the stable app-owned id, file path, or resource id.
- `createdAt` - an ISO timestamp.
- `source` - provider/app/source ids used to create it.
- `summary` - a short human-readable explanation.
- `items` or `records` - the bounded structured data downstream apps need.
- `links` - fully qualified URLs for user-visible artifacts.

Downstream apps should receive artifact ids, URLs, and narrow follow-up
questions. If a downstream app needs more detail, it should call back to the
artifact-owning app instead of asking the orchestrator to paste the whole
corpus into a prompt.

Example: `hubspot-pipeline` returns `{ artifactType: "deal-set",
artifactId: "hubspot-pipeline:deal-set:2026-06-18" }`. `deal-brief` passes
that id to `gong-evidence`, which returns a `call-evidence` artifact id and
URLs. `deal-brief` then synthesizes the final brief from the artifact ids and
bounded summaries.

## Provider APIs

Provider-specific actions are shortcuts, not limits. When the upstream API can
answer the question better than a first-class shortcut, call
`provider-api-catalog` and `provider-api-docs` as needed, then
`provider-api-request` against the real provider endpoint. For broad joins,
searches, or absence claims, stage the bounded corpus with `stageAs` and reduce
it with `query-staged-dataset` or code.

When composing apps, make the provider-owning mini-app do those
`provider-api-request` calls. The orchestrator should delegate a bounded job;
it should not reimplement every provider endpoint locally.

## Example

For a sales-intelligence workspace, split the job into small apps:

| App | Owns | Calls |
| --- | --- | --- |
| `hubspot-pipeline` | CRM deals, contacts, companies, associations | `provider-api-request` with provider `hubspot` |
| `gong-evidence` | Calls, transcripts, snippets, speaker evidence | `provider-api-request` with provider `gong` |
| `knowledge-base` | Internal docs, pricing rules, playbooks | local search/read actions |
| `deal-brief` | Orchestration and final brief | `invokeAgent()` or `call-agent` to the three apps |

Flow: `deal-brief` asks `hubspot-pipeline` for the target account and open
deals, asks `gong-evidence` for recent transcript evidence about those deals,
asks `knowledge-base` for relevant playbook guidance, then synthesizes the
answer. That is a HubSpot→Gong→knowledge-base chain made of focused apps,
not a single app that clones every provider integration.

## Don't

- Do not clone Mail, Calendar, Analytics, Brain, Assets, or another first-party
  app just to reuse its data. Delegate or link to the existing app.
- Do not hide a multi-provider workflow inside a giant "misc tools" app.
- Do not add one-off provider endpoints when `provider-api-request` can express
  the upstream API safely.
- Do not create wrapper routes that only re-export another app's action or A2A
  result.

## Related Skills

- **a2a-protocol** - How apps expose and call A2A endpoints.
- **actions** - How each mini-app exposes its own operation surface.
- **external-agents** - How external MCP hosts route through workspace apps.
- **storing-data** - How app-owned data stays SQL-backed and portable.
