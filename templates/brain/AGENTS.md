# Brain — Agent Guide

Brain is an agent-native workspace knowledge system: ingest sources, distill
memories, answer with cited evidence, and capture durable learnings through
actions and shared state.

## Skills

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

Read the matching skill before deeper work:

- `brain` — ingestion, distillation, retrieval, and review flows, the
  `sourcePolicy` table, publish-tier/proposal gating, evidence quotes, capture
  sanitization, and the full per-action reference.
- `ask-across-everything` — cross-source answers and `federatedCoverage`
  delegation.
- `ingestion-and-connectors` — source lifecycle, providers, health states,
  credential resolution, and raw provider HTTP.
- `brain/RUNBOOK.md` — Brain internals and ops (search layers, distillation
  worker, scheduled sync, Slack rollout, demo/eval, ingest payloads); read it
  only when operating or debugging internals. It is a file inside the `brain`
  skill, not its own skill slug.
- `agent-native-toolkit` — check existing kits and package seams before
  building workspace or agent UI.
- `customizing-agent-native` — the configure → compose → eject → propose seam
  ladder.
- `adding-a-feature` — Brain feature changes.
- `actions`, `real-time-sync`, `security`, `frontend-design`, and `shadcn-ui`
  for framework work; `actions` covers the shared provider API pattern.

## Core Rules

- Never put large payloads in SQL — no base64, `data:` URLs, images,
  video/audio, PDFs, ZIPs, screenshots, thumbnails, or replay chunks in app
  tables, `application_state`, `settings`, or `resources`. Use configured
  file/blob storage and persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use Brain actions for ingestion, search, retrieval, distillation, capture,
  review, and connector work. Do not bypass access checks or ownable scopes.
- **Call `get-brain-settings` before answering, searching broadly, or
  distilling** if it isn't already in context; it encodes the retrieval and
  distillation rules as concrete policy (see `brain`).
- Retrieval answers must be evidence-backed. Cite or summarize source context
  and clearly separate facts from inference.
- Do not fabricate source contents, dates, people, permissions, or connector
  health. Inspect sources when unsure.
- Capture only durable, useful knowledge. Avoid storing secrets, transient
  noise, or unsupported personal data.
- Use `view-screen` when the active source, review item, search, or collection
  is unclear.
- Evidence quotes must be exact substrings of the referenced capture; copy them
  from `get-capture` output.
- Sources support exactly six providers: `manual`, `generic`, `clips`, `slack`,
  `granola`, `github`. `create-source` rejects anything else.
- Use a blessed `generic` source for approved FAQs, docs, and handbooks. See
  `ingestion-and-connectors` for answer policy, updates, and deletion semantics.
- Reuse existing workspace integration grants (check `list-connection-providers`
  readiness) instead of duplicating provider tokens into Brain. Source sync
  actions are convenience readers, not integration limits — for an endpoint,
  filter, or payload they do not model, use `provider-api-catalog` /
  `provider-api-docs` / `provider-api-request`.
- If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the
  user explicitly asks to approve it now.

## Application State

- `navigation` exposes ask/search, sources, review, memory, connector, and
  selected item context.
- `navigate` moves the UI to a typed `view`: `home`, `ask`, `search`,
  `sources`, `source`, `capture`, `knowledge`, `review`, `proposals`,
  `extensions`, `ops`, or `settings`, with matching `sourceId` / `captureId` /
  `knowledgeId` / `proposalId` / `extensionId` / `query` / `provider` /
  `status` / `issue` params.
- Use retrieval actions for full source context, not ambient screen text.

## Action Map

| Action | Purpose |
| --- | --- |
| `get-brain-settings` | Identity, tone, `sourcePolicy`, citation, distillation settings. |
| `search-everything` | Broad search over knowledge, captures, sources + `federatedCoverage`. |
| `search-knowledge` | Text search over distilled knowledge only. |
| `ask-brain` | Cited-answer endpoint with `federatedCoverage`. |
| `get-knowledge` / `list-knowledge` | Read or list distilled knowledge. |
| `get-capture` / `list-captures` | Read or list raw captures (redacted by default). |
| `import-capture` / `import-transcript` | Ingest and queue a capture or transcript for distillation. |
| `enqueue-distillation` / `mark-capture-distilled` | Queue distillation; close the queue row. |
| `write-knowledge` | Write/update knowledge; may return a pending proposal. |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Human review of gated writes. |
| `set-knowledge-canonical` | Mirror approved knowledge into workspace resources. |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source` | Source lifecycle. |
| `sync-source` / `sync-due-sources` | Run one connector, or sweep all due sources. |
| `get-brain-health` | Source health, sync freshness, queue/proposal counts. |
| `list-connection-providers` | Provider readiness and credential health. |
| `test-slack-connection` / `run-slack-pilot` | Slack validation and first-sync report. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Raw provider HTTP. |
| `run-demo-eval` / `run-retrieval-eval` / `seed-demo-data` | Demo corpus and eval checks. |
