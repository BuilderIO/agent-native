# Agent Native E2EE Expansion Strategy

Status: cross-app direction complete; Content implementation ready for `/work`
Decision date: 2026-07-16
Reference contract: [Content Encryption Trust Contracts](./content-encryption-trust-contracts.md)
Implementation route: [Content E2EE Implementation Wayfinder](./content-e2ee-implementation-wayfinder.md)

## Decision

Start with **Content as the first complete end-to-end encrypted product**, but build its encryption and trusted-execution substrate as reusable framework infrastructure from the first milestone.

Do not make every Agent Native app “E2EE” by default and do not commit the whole product suite to one undifferentiated privacy claim. Each app must instead declare an honest privacy contract for each resource or workspace:

- **Private Vault:** Agent Native's hosted plane stores ciphertext and admitted metadata, while enrolled user endpoints hold keys and perform protected work.
- **Provider-connected:** an external system such as Gmail, Google Calendar, Notion, or a data warehouse necessarily sees the data; Agent Native minimizes its own retention and discloses where processing occurs.
- **Public or hosted workflow:** the user deliberately publishes data or asks a hosted service to receive/process it; private source material remains protected unless explicitly disclosed.
- **Always-on trusted broker:** a named personal or user-cloud endpoint receives narrowly scoped keys and background authority.

The reusable unit is an **encrypted workspace or vault spanning compatible apps**, not an “E2EE app” badge. A Content document, Brain note, Plan artifact, or Clip may belong to the same encryption domain and use the same enrolled broker. Apps supply resource semantics; the framework supplies custody, execution, and disclosure rules.

## Why Content goes first

Content exercises nearly every hard requirement in one coherent product:

- Rich text, hierarchy, databases, versions, comments, search, and semantic derivatives.
- Agent reads and writes through the same named actions as the UI.
- Multi-device synchronization, collaboration, sharing, media, export, and migration.
- Explicit egress through publishing, hosted models, Notion, Builder, and transcription.
- A credible future path for `teenylilthoughts`, which provides a concrete high-sensitivity acceptance case.

If the architecture can preserve Content's ordinary agent experience while the hosted service remains blind to protected material, most reusable primitives will have survived a meaningful test. Starting simultaneously across every template would multiply incompatible migrations and UI states before the trust kernel has been proven.

## Framework capabilities built during Content

The initial implementation must avoid Content-specific protocol names and assumptions. It should introduce generic framework primitives for:

- Encryption domains, enrolled endpoint identity, key envelopes, key epochs, rotation, recovery, and revocation.
- Ciphertext object and blob synchronization with opaque revisions.
- A universal action-execution resolver that can place protected actions on an enrolled broker while preserving the existing action vocabulary.
- Capability grants binding user, agent, endpoint, resources, operations, provider, destination, retention, expiry, and background authority.
- Opaque queues and encrypted results for unavailable or always-on brokers.
- Private indexes and protected derivative state.
- Content-free or encrypted audit, run, tool, dispatch, application-state, observability, and disclosure records.
- Explicit public, provider, model, integration, and export egress boundaries.
- A resource privacy manifest declaring protected fields, execution placement, admitted metadata, egress, and features that must fail closed.

Shared agent infrastructure must become capable of carrying protected workflows without leaking prompts, tool inputs, results, or derived state. That is framework-wide E2EE readiness, not automatic E2EE for every app's data model.

## App-family direction

| App family | Recommended contract | Direction after Content |
| --- | --- | --- |
| Content | Private Vault foundation with explicit publishing and integration egress | First complete reference implementation |
| Brain | Optional Private Vault collections for captures, knowledge, indexes, and summaries; ingestion providers remain named readers | High-value later candidate after trusted background ingestion and distillation are solved |
| Macros | Private Vault for personal nutrition, exercise, and weight records | Early small-domain validation candidate, pending its own plaintext audit |
| Plan, Slides, Design | Optional encrypted private workspaces; public sharing/export creates separate disclosed artifacts | Adopt after the shared artifact and collaboration primitives stabilize |
| Clips | Private Vault for recordings, transcripts, thumbnails, and meeting derivatives | High-value later milestone because encrypted streaming, range reads, transcription, and large-file processing are substantial work |
| Forms | Public form definition where intended; optional browser-to-owner encryption for private responses | Add an encrypted-response mode; disclose that hosted automation/webhooks require plaintext egress |
| Mail | Provider-connected: Gmail or another mail provider already sees messages; Agent Native should minimize retention and use a trusted broker for private search/drafting | Do not market as end-to-end encrypted mail unless the message protocol itself changes |
| Calendar | Provider-connected for synced calendars and hosted booking/free-busy workflows; encrypt Agent Native-only private annotations where useful | Minimize cached data and make provider/server execution visible |
| Analytics | Provider-connected for warehouses and data services; optionally encrypt saved private analyses and artifacts | Emphasize least authority, bounded queries, and retention rather than blanket E2EE |
| Dispatch | Isolation and minimization for its always-on routing plane; protected payloads may travel as encrypted envelopes only where endpoints can process them | Eliminate plaintext credential duplication and use explicit channel/provider boundaries, not a blanket app claim |
| Chat, Voice, Videos | Protect conversations, recordings, and run artifacts when they belong to an encrypted workflow | Consume the shared encrypted-run and media primitives rather than inventing separate key systems |

## Rollout sequence

### Phase 1 — Content reference kernel

Implement and independently review the Private Vault slice already defined in the Content trust contract and implementation wayfinder. Keep unsupported plaintext-dependent features visibly unavailable and fail closed. Do not migrate `teenylilthoughts` during this phase.

### Phase 2 — Prove reuse in two unlike domains

After Content's synthetic vault passes the launch gates, adopt the substrate in:

1. **Macros**, to prove a smaller, highly sensitive personal-data app can adopt the framework without inheriting Content's complexity.
2. **Plan**, to prove a second rich-artifact app can keep private work encrypted while publishing a deliberate plaintext snapshot.

These two implementations should reveal whether the framework boundary is genuinely reusable or merely Content wearing a fake moustache. Brain should follow once trusted background ingestion, distillation, search, and provider disclosure can work without turning the hosted service back into a plaintext knowledge engine.

### Phase 3 — Artifacts, media, and encrypted intake

- Extend optional encrypted workspaces from Plan to Slides and Design.
- Add encrypted media streaming and derivatives for Clips.
- Add browser-to-owner encrypted response collection for Forms.

### Phase 4 — Provider-connected privacy

Apply the same grants, broker placement, minimization, disclosure, and protected-run infrastructure to Mail, Calendar, Analytics, and Dispatch. Give each app a precise provider-connected contract rather than relabeling provider-readable data as end-to-end encrypted.

## Expansion gates

An app may adopt the Private Vault claim only when:

1. Its complete plaintext and derivative inventory is documented.
2. Every protected action uses the universal execution resolver or an equivalently proven protected path.
3. Hosted storage, logs, queues, audit, application state, run history, analytics, and support surfaces retain no protected plaintext.
4. Public, provider, integration, model, and export egress is explicit and scoped.
5. Broker-unavailable behavior fails closed without falling back to hosted plaintext execution.
6. Recovery, revocation, removal, export, deletion, and migration behavior is tested for that resource type.
7. The app's user-facing language names who can read what; it does not rely on a universal lock badge.

## Scope of the first implementation program

The first fork program should include:

- The reusable framework kernel required by Content.
- The Content Private Vault reference implementation and its assurance evidence.
- A resource privacy manifest capable of describing later apps, defined and enforced first in implementation PR 3.
- Cross-app tests proving protected action inputs and results cannot leak through shared framework surfaces.

It should not include production E2EE migrations for the other templates. Their schemas, feature failures, public/provider boundaries, and adoption work should remain subsequent programs until the Content kernel has passed independent review and a second app has demonstrated real reuse.

## Final product principle

The goal is not “every Agent Native app has a lock.” The goal is that every piece of user data has a legible home, every plaintext reader is named, and every agent can keep working within the authority the user deliberately gave it.

That makes E2EE a shared capability, Content the proving ground, and privacy contracts the rule across the suite.
