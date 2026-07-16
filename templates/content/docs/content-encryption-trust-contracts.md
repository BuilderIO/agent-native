# Content Encryption Trust Contracts

Status: shaped product decision; not yet a launch claim
Decision date: 2026-07-16
Parent map: [Content Security and E2EE Wayfinder](./content-security-e2ee-wayfinder.md)
Baseline evidence: [Content data-isolation audit](./content-data-isolation-audit-2026-07-13.md)
Implementation route: [Content E2EE Implementation Wayfinder](./content-e2ee-implementation-wayfinder.md)
Cross-app direction: [Agent Native E2EE Expansion Strategy](./agent-native-e2ee-expansion-strategy.md)

## Summary

Content will have one encrypted personal-vault foundation and two initial access profiles:

1. **Private Vault** is the default. User-held keys, trusted user endpoints, and a local Content broker provide end-to-end encrypted storage with ordinary agent usability. If no trusted endpoint is reachable, work waits in an encrypted queue.
2. **Always-on Personal Automation** is an explicit addition. The user enrolls an always-on personal or user-controlled cloud broker and gives it narrowly scoped background authority. It is another trusted endpoint, not a vendor-held recovery key and not a silent downgrade of the whole vault.

The shared invariant is that Agent Native's hosted sync, SQL, blob storage, CDN, backups, support tooling, and ordinary operators do not possess the keys needed to decrypt protected vault data. An explicitly chosen agent, model provider, collaborator, integration, public audience, or always-on broker may receive plaintext only through a visible grant or disclosure boundary.

This direction preserves the product's defining interaction: after a deliberate standing grant, a user can ask an agent what content they have and ask it to read, create, edit, organize, or use that content through the normal Content actions. Encryption changes where actions execute, not the conversational vocabulary.

## Private Vault beta decisions

- **Client:** the first beta is available only through a signed, verifiable Agent Native desktop build. The hosted browser may show public artifacts and content-free account/broker status, but it cannot unlock a vault, display protected content, collect a protected prompt, or queue vault work.
- **Agent placement:** for vault-scoped work, the agent orchestration loop runs on the enrolled broker. A chosen hosted model may receive the explicitly disclosed prompt and passages, but Agent Native's hosted framework is not a plaintext intermediary or retained run-history store.
- **Encryption domain:** one personal vault is one membership, rotation, and recovery domain. Team vaults, sharing, cross-vault moves, and partial-subtree rekeying are outside the beta.
- **Device enrollment:** the first desktop creates the vault. A second device must be authorized and its identity verified by an existing enrolled endpoint or by independently held recovery material; the hosted endpoint directory is not trusted to add devices by itself.
- **Recovery:** enrollment requires the user to create and verify independently held recovery material or enroll a second recovery-capable device. Agent Native cannot recover the vault. Losing every enrolled endpoint and recovery path means permanent loss.
- **Metadata leakage:** the beta admits ciphertext lengths, server receipt timing, IP/network logs, opaque object access patterns, and content-free routing/health facts. It makes no padding or traffic-analysis-resistance claim.
- **Legacy surface:** existing plaintext Content remains separately labeled **Standard Cloud** during the beta. It retains the server-readable behavior described by its own contract and is never an automatic fallback for a Private Vault.

## Product promise

The intended external promise is:

> Your private vault is end-to-end encrypted. Agent Native stores and synchronizes ciphertext but does not hold the keys required to read it. Plaintext is available only on endpoints you enroll and to people or services you explicitly authorize for particular content or work.

This promise must not be shortened to “only you can read your data”: invited collaborators, authorized agents, chosen model providers, and disclosed integrations may intentionally receive plaintext. Content should not claim “zero knowledge” until the protected-field and metadata budgets, client-integrity model, recovery design, and independent evidence support that narrower term.

## Protected-data boundary

The Private Vault contract covers user-authored content and its private derivatives:

- Document titles, bodies, blocks, hierarchy labels, comments, mentions, and database properties.
- Version history, collaborative-editing state, attachments, thumbnails, transcripts, previews, and extracted text.
- Private search and semantic indexes, embeddings, snippets, summaries, and other content-derived caches.
- Agent tool inputs, tool results, queued work, and retained run artifacts that contain or derive from vault material.
- Exports and backups produced as part of the encrypted vault workflow.

The service may require a deliberately minimized metadata envelope for routing and synchronization: account and workspace identifiers, enrolled-device public keys, opaque object identifiers, ciphertext sizes, coarse timestamps, key epochs, encrypted key envelopes, job state, and access events. The exact metadata budget, size-padding policy, and access-pattern leakage remain launch-blocking design work. User-authored names, titles, snippets, properties, and prompts are not acceptable routing metadata.

Publications, emails, external integrations, model calls, and files intentionally exported in plaintext leave this protected boundary. Content must disclose that crossing before the first grant, remember the approved scope, and record subsequent use without placing plaintext into the audit event.

## Contract 1: Private Vault

### What the user receives

- The vault is encrypted before protected data reaches Agent Native's hosted infrastructure.
- Vault keys are created, unlocked, and used only by enrolled trusted endpoints and explicitly authorized recipient endpoints.
- Agent Native's hosted storage and ordinary operational access expose ciphertext and permitted metadata, not protected plaintext.
- Private search, database evaluation, and normal Content actions execute on a trusted endpoint against decrypted local state.
- A standing agent grant removes repeated approval prompts within its scope. Existing confirmation rules for destructive, irreversible, external, or high-consequence operations still apply independently.
- When no enrolled broker is reachable, reads and writes requiring plaintext wait. The service never falls back to a vendor key, a plaintext index, or a weaker execution path.
- Queued requests, results, and status details remain encrypted except for the minimum routing metadata explicitly allowed by the metadata budget.
- Recovery does not depend on Agent Native holding a spare decryption key. The final recovery mechanism may use recovery material, another enrolled device, hardware keys, or explicit social recovery; loss may be irreversible if every recovery path is lost.
- The user can inspect enrolled endpoints, active grants, recent decryptions/disclosures, and revocation state.

### Agent behavior

The local Content broker exposes the same action vocabulary as the UI, including listing, search, read, create, edit, organize, and database operations. The complete vault-scoped agent loop executes on that broker; hosted Agent Native services receive no plaintext tool input, result, or retained run transcript. Each standing grant binds at least:

- User and agent identity.
- Enrolled broker endpoint.
- Vault, collection, document, or property scope.
- Allowed read, write, organize, publish, integration, and outbound operations.
- Approved model/provider and destination.
- Interactive versus background authority.
- Expiry, retention policy, and revocation state.

The broker releases only the plaintext needed for the authorized operation. A hosted model becomes an intentional reader of the passages, prompts, tool results, and outputs sent to that run; it does not receive the vault key. Content records the disclosure envelope—who, scope, provider, operation, time, and outcome—without copying disclosed plaintext into central logs.

An instruction received through email, Slack, or another integration inherits that channel's privacy boundary: the channel provider can see what the user sent there. The encrypted vault retrieval and action still wait for a trusted broker unless the user has enrolled an always-on broker with matching authority.

### What this contract does not protect against

- A compromised, unlocked, or malicious enrolled endpoint.
- A collaborator, agent, model provider, integration, or recipient retaining plaintext it was legitimately given.
- Screenshots, manual copying, or information remembered before access was revoked.
- Metadata and traffic analysis explicitly admitted by the final metadata budget.
- Malicious client code delivered through a compromised update channel.

The strong compromised-server promise therefore requires a trusted client-distribution boundary. A signed, verifiable desktop client is the first beta trust anchor. An ordinary mutable web bundle served by the potentially compromised service cannot, by itself, prove that it will not steal keys and is excluded from private-vault plaintext handling.

### Sharing, removal, publishing, and integrations

- Sharing wraps the relevant content keys to verified recipient devices; it does not make the server a recipient.
- Removing a person, device, or broker prevents future key access after rotation. It cannot make a recipient forget previously received plaintext.
- Publishing creates an explicit public plaintext artifact or equivalent public decryption boundary. Unpublishing ends future authorized delivery but cannot retract copies already fetched.
- Integrations receive only the data and operations named by a standing grant. Scope expansion fails closed and asks for a new decision.
- Extensions and peer apps are never trusted merely because they run inside Agent Native or share an organization. They require identity-bound, version-bound capabilities with explicit egress authority.

## Contract 2: Always-on Personal Automation

Always-on Personal Automation adds a named, continuously reachable trusted endpoint to an otherwise encrypted vault. It does not change Agent Native's hosted sync plane into a plaintext service.

### Enrollment contract

- The user deliberately enrolls either a personal node they control or a broker running inside their own cloud account.
- Enrollment identifies the endpoint, software identity/version, hosting location, owner, update policy, and last successful attestation or integrity check where applicable.
- The broker receives collection-, task-, or epoch-scoped keys and capabilities. It does not receive the vault root key simply because doing so is convenient.
- The user chooses which collections, operations, providers, schedules, destinations, and retention rules may run unattended.
- The enrollment screen names the new reader plainly. For a user-cloud broker, the user's cloud account/provider and anyone who compromises that environment join the trust boundary.
- The user can revoke the broker immediately. Revocation rotates future access keys, cancels pending work, and visibly reports any cleanup that cannot be proven.

### Runtime contract

- Background work runs only within standing authority. Requests for broader content, a new provider, a new outbound destination, or a higher-consequence operation fail closed.
- The broker keeps private indexes and decrypted working state locally, encrypted at rest under endpoint-held material, with a bounded retention policy.
- Agent Native's hosted scheduler may deliver opaque jobs and receive encrypted results, but it does not receive vault plaintext or broker decryption keys.
- Every execution produces a tamper-evident disclosure record readable by the user: task, endpoint, agent, scope, provider, external destination, time, and outcome.
- If the broker is offline, unhealthy, expired, unverifiable, or revoked, work queues or fails visibly. It never migrates to a vendor-readable runtime without a separate explicit grant.
- Software updates must preserve endpoint identity and grant boundaries. A material trust-boundary change requires re-enrollment or renewed consent.

### Availability and recovery

Always-on means eligible for unattended execution, not infallible. The product should report missed schedules and broker health honestly. A personal node carries home-network and hardware risk; a user-cloud broker carries cloud-account, provider, patching, and cost risk.

The always-on broker is recoverable as a removable enrolled endpoint. Losing it must not lose the vault if the user retains another device or recovery path. Recovering the account must not silently restore the broker's old background authority.

## Actor and reader matrix

| Actor | Private Vault | With Always-on Personal Automation |
| --- | --- | --- |
| Another unshared Content user | Cannot read protected data | Cannot read protected data |
| Agent Native SQL, blob storage, CDN, backups | Ciphertext and admitted metadata only | Same |
| Agent Native support and ordinary operators | Cannot decrypt protected data | Same |
| Enrolled user device/local broker | Can decrypt while unlocked and authorized | Same |
| Enrolled personal or user-cloud broker | Not present | Can decrypt only granted scopes while enrolled |
| Explicit collaborator | Can read shared scopes on authorized devices | Same |
| Chosen hosted agent/model provider | Sees plaintext deliberately sent for an authorized run | Same, including authorized unattended runs |
| Email, Slack, Notion, Builder, or other integration | Sees explicitly disclosed content and instructions | Same, potentially unattended within its grant |
| Public visitor | Sees only explicitly published artifacts | Same |
| Organization administrator | No inherent personal-vault decryption authority | No inherent authority unless a separate enterprise contract is chosen |
| Compromised enrolled endpoint | May read what that endpoint can access | May read the broker's granted scopes; narrower grants limit blast radius |

## Mode and grant transitions

- Private Vault is the foundation, not one side of a reversible privacy toggle.
- Adding Always-on Personal Automation enrolls an endpoint and grants bounded authority; it does not decrypt the vault into a separate server-readable database.
- Expanding a grant is an explicit user decision. Narrowing or revoking one is immediate and cannot be blocked by a convenience prompt.
- No import, migration, update, collaboration action, or automation may silently add a decrypting endpoint.
- No unavailable feature may trigger a plaintext compatibility fallback. Unsupported encrypted workflows fail closed with specific guidance.
- Moving to a future organization-managed or vendor hardware-isolated contract requires a separately named product promise and an explicit migration ceremony.

## Non-negotiable product invariants

1. Agent Native never holds a universal or recoverable vendor copy of personal-vault root keys.
2. Every plaintext reader is a named endpoint, recipient, or provider that the user can discover from the product.
3. Agent grants are identity-bound, resource-scoped, operation-scoped, provider-aware, expiring or reviewable, auditable, and revocable.
4. Search and semantic indexes are protected data, not a convenient metadata loophole.
5. Audit and observability systems record disclosure facts without retaining protected plaintext.
6. Unavailability fails closed; it never weakens encryption.
7. Public publishing, external sending, integrations, and hosted model calls are explicit egress boundaries.
8. Revocation protects future access but never claims to erase plaintext already received.
9. Recovery language states who can recover keys and what is irrecoverable.
10. Marketing claims follow demonstrated properties. A lock icon is not allowed to improvise constitutional law.

## Execution placement

Execution is **split**:

- **Local or user-controlled broker:** key custody, decryption, private indexes, content-aware actions, and agent-grant enforcement.
- **Framework-hosted:** authentication, ciphertext sync and blob relay, opaque job scheduling, public artifacts, permitted metadata, and encrypted audit/disclosure envelopes.
- **Chosen external providers:** only the plaintext and actions explicitly disclosed for a granted model call, email, publication, or integration.

An always-on broker must be independently relocatable. It cannot depend on Alice's laptop, Framework hardware, or any particular NixOS host remaining online; taking a personal machine offline must degrade to visible queueing rather than data exposure or silent execution elsewhere.

## Launch gates

These contracts become product claims only after:

- The existing CDN, Notion confused-deputy, shared-extension, A2A impersonation, Local File Mode, and media-revocation findings are remediated and verified in the deployed system.
- The complete plaintext/derivative inventory and exact metadata budget are closed.
- The signed-desktop-only beta boundary is enforced: hosted browser code cannot unlock, prompt, render, or queue protected vault work.
- Agent loops for protected work execute only on enrolled brokers; hosted run history and tool ledgers contain no protected plaintext.
- Ciphertext size, timing, network, and access-pattern leakage is documented in-product, or a later padding design is implemented and independently tested before making a stronger claim.
- The key hierarchy, device identity, recovery, sharing, removal/rotation, encrypted collaboration, private search, media, export, and migration designs survive adversarial prototypes.
- Client integrity and update-channel assumptions are explicit and tested.
- Two-account and removed-device tests prove isolation, fail-closed behavior, disclosure logging, revocation, and absence of plaintext fallbacks.
- Protocol and implementation receive independent cryptographic design review and security testing before any E2EE or zero-knowledge marketing claim.
- A disposable synthetic vault passes migration, recovery, export, deletion, and rollback drills. Real `teenylilthoughts` content remains out of scope until those gates pass.

## Open design questions

The contracts settle key custody, beta client placement, agent-loop placement, personal-vault domain, recovery authority, and the initial metadata-leakage claim. They do not prematurely choose:

- Cryptographic primitives, key hierarchy, device discovery, or recipient-key verification.
- Cryptographic encoding of recovery material and the concrete device-verification ceremony.
- Whether a later release adds padding or traffic-analysis mitigations beyond the beta's admitted leakage.
- Collaboration epochs, offline merge behavior, private database/search architecture, and encrypted media streaming.
- The finest practical grant/subkey granularity and default expiry/review cadence.
- Which agent providers qualify for standing grants and how their retention settings are verified.
- Packaging, pricing, and operational support for personal-node and user-cloud brokers.
- A separate organization-managed or hardware-isolated hosted contract.
- The sunset or long-term support policy for the separately labeled Standard Cloud surface.

## Recommended next stage

Use these contracts to drive `/work` in this order:

1. Inventory production exposure and complete the F3/F4 evidence matrix.
2. Convert the settled protected-data, metadata, device, and recovery policies into exact field tables, ceremonies, and failing tests.
3. Land baseline isolation PRs 1–2 upstream.
4. Specify the agent capability, resource privacy manifest, and disclosure objects as executable schemas in PR 3.
5. Build the ciphertext relay, signed-desktop broker, and one encrypted-document vertical slice through PRs 4–6.
6. Complete migration/recovery and independent release assurance through PRs 7–8.
7. Only after the Private Vault slice survives review, prototype an enrolled always-on broker with collection-scoped authority.

This contract is ready to hand to `/work`; it does not itself start implementation or authorize a real-vault migration.
