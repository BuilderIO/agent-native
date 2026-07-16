# Content Security and E2EE Wayfinder

Status: charted 2026-07-13
Source snapshot: `379af14ca08fb7965d20b87236e8b268765dfb15`
Related evidence: [Content data-isolation audit](./content-data-isolation-audit-2026-07-13.md)
Trust contracts: [Content Encryption Trust Contracts](./content-encryption-trust-contracts.md)

## Destination

Produce an implementation-ready product and trust-boundary brief for a version of Content that can safely hold a sensitive personal vault and support intentional collaboration, agents, publishing, and integrations without quietly weakening its privacy promise.

Wayfinding is complete when the brief defines:

- The exact external promise and threat model.
- The baseline isolation and revocation gates that must ship whether or not E2EE exists.
- Which data and metadata are encrypted, who holds keys, and how devices, sharing, removal, and recovery work.
- How collaboration, search, databases, media, public publishing, integrations, and agents behave while content is encrypted.
- How an existing vault is migrated, exported, backed up, deleted, and recovered.
- The executable security properties and independent evidence required before the product makes an E2EE claim.

## Framing

“Secure Content” has four layers. They reinforce one another but are not substitutes:

1. **Tenant isolation and least authority** — one account, extension, integration, or peer app cannot act as another.
2. **Reliable revocation** — caches, blobs, public links, tokens, and integrations stop serving protected material when access ends.
3. **End-to-end confidentiality** — the service stores and relays ciphertext; only intended user devices and explicitly authorized recipients hold decryption keys.
4. **Endpoint and protocol integrity** — the client, extension runtime, key directory, recovery system, and update channel cannot silently subvert the first three layers.

Encrypting only `documents.content` would achieve none of these completely. Plaintext currently also appears in titles, versions, comments and quoted anchors, database properties and source payloads, Builder sidecars, Yjs state and text snapshots, audit inputs, media URLs, public rendering, agent transcripts, exports, and integration sync state.

The most distinctive product hypothesis is not merely “AI plus encryption.” It is **user-held keys with explicit, inspectable grants to agents**: this agent, these documents, these operations, this provider, this duration. That remains a hypothesis until the agent-access frontier is resolved.

## Decisions so far

- Database-backed document CRUD is mostly private-by-default and consistently uses the framework access primitives.
- The current app is server-readable and is not E2EE or zero-knowledge.
- The prior audit’s CDN, Notion, extension, A2A, Local File Mode, and media findings are migration blockers independent of encryption.
- `teenylilthoughts` should not move to a shared hosted Content instance before those gates close and the deployed system passes adversarial verification.
- E2EE is a product and protocol change across Content and core, not a schema-column enhancement.
- The local plaintext vault and local device encryption are separate trust layers; hosted E2EE does not encrypt a local filesystem by magic.
- Conversational agent parity is non-negotiable. A user must still be able to ask their chosen agent what content they have and tell it to read, create, edit, organize, or use that content without an encryption-specific approval on every tool call.
- Agent authorization should be deliberate, durable, identity-bound, inspectable, and revocable. Encryption may change where an action executes, but it must preserve the shared Content action vocabulary and ordinary conversational workflow.
- Private Vault and Always-on Personal Automation trust contracts are selected; cryptographic primitives, key hierarchy, and recovery mechanics remain intentionally unselected.

## System facts that constrain the route

- Content stores canonical title/body plaintext in SQL, with additional plaintext copies and derivatives across versions, comments, database rows/properties, source snapshots, change sets, execution payloads, and block fields (`server/db/schema.ts`).
- Search uses server-side SQL `LIKE` over titles and bodies and builds snippets on the server (`actions/search-documents.ts`).
- The collaboration server maps Yjs to `documents.content` and persists mergeable state plus a plaintext snapshot; it is currently an active plaintext peer, not an opaque relay (`server/plugins/collab.ts`, `packages/core/src/collab/storage.ts`).
- Document updates can be copied into action audit inputs; agent runs and tool results create additional derived stores that need classification (`packages/core/src/audit`).
- Media is uploaded raw to a provider and represented by a URL in Markdown; server-private blobs exist in core but are not E2EE (`app/components/editor/image-upload.ts`, `packages/core/src/private-blob`).
- Notion/Builder sync, transcription, server-side versions/restores, database filtering/joins, public SSR, and hosted agents all currently require server-readable material.
- A web E2EE client served by the same potentially compromised server has a code-delivery problem: malicious JavaScript could steal keys. The final promise may require signed/reproducible clients, a trusted desktop app, key transparency, or an explicitly narrower threat model.

## Feasibility finding: preserve agents through a local key broker

The requirement is possible if the agent is treated as an explicitly authorized endpoint and Content separates its **encrypted sync plane** from a **trusted plaintext action plane**.

```text
Chosen agent (local or hosted)
        |
        | identity-bound, scoped Content tools
        v
Trusted Content broker on a user-controlled endpoint
  - holds or unlocks vault keys
  - maintains private search/index state
  - decrypts reads and encrypts writes
  - executes the existing Content action contract
  - records and enforces the agent grant
        |
        | ciphertext and permitted metadata only
        v
Content sync, SQL, blob storage, CDN, and backups
```

The broker could live in Agent Native Desktop, a local daemon/CLI, or another user-controlled always-on node. MCP already supports local servers and protected remote resources; its authorization model requires tokens to be bound to the intended resource rather than passed through to downstream systems. That is compatible with giving an agent a durable Content capability without giving the Content service a vault key. WebCrypto explicitly describes encrypting documents before cloud upload and wrapping document keys for authorized viewers. These establish feasibility, not a complete protocol.

The agent should continue to see familiar tools such as `list-documents`, `search-documents`, `get-document`, `edit-document`, and `create-document`. The difference is execution placement:

- Reads and search execute against decrypted local state or a client-side index.
- Writes arrive as structured actions, apply locally, and sync only ciphertext.
- A local agent can keep plaintext entirely on the trusted device.
- A hosted agent receives the plaintext needed for the requested run, so that model/provider becomes an intentionally authorized reader of that disclosed material. The storage/sync service can remain blind, but the product must not claim that the hosted model never sees what the user asked it to process.
- A durable agent grant can avoid per-call ceremony while remaining visible and revocable: agent identity, vault/space scope, read/write operations, providers, expiry, and background authority.
- Existing high-consequence confirmation rules remain independent. Encryption should not add a second click ritual to every ordinary read or edit.

There is an unavoidable availability triangle. A design cannot simultaneously provide all three:

1. Strict server-blind E2EE.
2. A hosted/background agent that works while every trusted user endpoint is offline.
3. No additional always-online trusted key holder.

An offline background agent therefore requires one explicit trust choice: an always-on personal node, a user-controlled cloud agent/key broker, an organization-managed agent endpoint, or a confidential-computing service with a narrower claim than strict user-endpoint-only E2EE. Silent server escrow is not an acceptable fifth option wearing a false moustache.

Primary feasibility references:

- [W3C Web Cryptography: protected document exchange and pre-upload cloud encryption](https://www.w3.org/TR/webcrypto/#use-cases)
- [Model Context Protocol authorization: resource-bound tokens and protected servers](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP security guidance for local servers](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [RFC 9420 Messaging Layer Security: client-held group epochs and post-removal future-message protection](https://www.rfc-editor.org/rfc/rfc9420)
- [Local-first software: local ownership, offline work, collaboration, and CRDTs](https://www.inkandswitch.com/essay/local-first/)

## Decision aid: who keeps the key while the user sleeps?

The child-simple model is a locked toy chest. Content's cloud can store and move the chest without holding its key. A trusted broker is the helper who has the key and can answer an authorized agent. If every key-holding helper is asleep, a remote agent must either wait or the user must deliberately leave a narrowly scoped key with another helper who stays awake.

Ordinary agent usability and unattended agent availability are separate decisions. A durable, inspectable grant lets an agent use familiar Content actions without asking for approval on every call; it does not require the product vendor to hold vault keys. The availability triangle appears only when a hosted job must run while every trusted user endpoint is offline.

| Model | Five-year-old version | Who may read plaintext? | Main benefit | Main cost or failure |
| --- | --- | --- | --- | --- |
| Local broker; work queues until wake | The key stays in your house. The helper waits at the door. | User devices, plus a chosen model for material deliberately sent to that run | Strongest, simplest server-blind promise; low routine friction while a device is online | No guaranteed clock-time background work while all devices sleep; recovery must be user-held or device-based |
| Always-on personal node | You leave one of your own lights on all night | The user's desktop, NAS, or home server | Strict vendor-blind E2EE plus unattended work | Hardware, networking, patching, uptime, and support burden; a dead node stops work |
| User-controlled cloud broker | You rent a tiny locked room and keep a helper there | The broker VM and anyone who compromises or controls that cloud account | Reliable unattended agents without giving Agent Native the key | The user's cloud provider/account becomes trusted; setup, updates, cost, and revocation must be made nearly automatic |
| Organization-managed endpoint | The school office keeps a key for the class | Authorized organization systems and potentially administrators | Good reliability, recovery, offboarding, and compliance for teams | The organization can read; this is the wrong trust contract for a private personal vault |
| Confidential-computing service | The vendor's helper works inside a tamper-resistant booth | Plaintext exists inside the attested workload; trust extends to the hardware root, attested code, and surrounding protocol | Low-friction, reliable hosted automation with stronger isolation than ordinary servers | A narrower promise than endpoint-only E2EE; expensive and complex; attestation proves measured code relative to its platform root, not the absence of all trusted infrastructure |
| Vendor key escrow | The warehouse keeps a spare key | Agent Native's services, operators with sufficient privilege, and compelled or compromised infrastructure | Easiest recovery and background execution | Not strict E2EE or zero knowledge; destroys the differentiating privacy promise |
| Clearly labeled hybrid | The user chooses which helper, if any, stays awake | Depends on the selected mode and grant | Serves both private-vault and unattended-agent needs honestly | Mode boundaries can become confusing or silently porous unless enforced and visible |

### Codex recommendation

1. Make **local broker plus queue-until-wake** the default personal-vault mode. The device holds keys and private indexes; a standing agent capability preserves ordinary conversation without approval confetti.
2. Treat an agent request received while devices are offline as an encrypted job envelope. Execute it when an enrolled broker wakes, then return the encrypted result. Clock-time guarantees are intentionally unavailable in this mode.
3. Offer the same broker as an optional always-on personal-node package and, later, as a one-click user-controlled cloud deployment. Enroll it like a device, give it only collection/task subkeys and necessary operations, make every disclosure auditable, and support immediate revocation. Never give it the vault root key merely for implementation convenience.
4. Explore confidential computing later for a clearly labeled hardware-isolated hosted mode, not as a synonym for pure E2EE. AWS's own model makes attestation depend on signed enclave measurements and a Nitro Hypervisor/PKI root of trust; that is useful evidence about a workload, but it is still a trust model ([AWS attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html), [AWS root of trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html)).
5. Keep organization-managed key authority as a later enterprise contract. Reject product-vendor escrow for encrypted spaces and never change a space into a weaker mode silently.

### Independent Fable recommendation

An independent `anthropic/claude-fable-5` pass agreed on the core route:

- Default to the local broker, strict server-blind E2EE, durable scoped agent capabilities, a private local index, disclosure logs, user-held recovery, and queue-on-wake behavior.
- Add a user-controlled cloud broker first for optional unattended work, with the personal node as a self-hosted variant. Use scoped subkeys or per-collection capabilities rather than the root vault key.
- Consider a reproducibly built, attested confidential-computing service later and label it hardware-isolated rather than E2EE.
- Reserve organization-managed authority for enterprise. Reject vendor key escrow.

Fable's sharpest warning was against quietly moving key custody to vendor infrastructure because background agents demo better that way. Its useful product insight is that the standing capability grant—not server key custody—is what removes per-tool-call friction.

### Provisional product choice

The recommended hybrid is not one fuzzy privacy slider. It is one strong default plus explicit trust additions:

1. **Private vault:** local keys, agents work immediately while a broker is reachable, and offline jobs wait.
2. **Always-on personal automation:** the user enrolls a personal or user-cloud broker and grants narrowly bounded background authority.
3. **Hosted hardware-isolated automation:** possible later, visibly outside the strict endpoint-only promise.
4. **Organization-managed workspace:** possible later under an organization-readable enterprise promise.

The product must show which endpoint can decrypt, which collections and operations it holds, when it last acted, what left the encrypted boundary, and how to revoke it. No mode may silently fall back to a vendor-held key.

## Frontier

Each question is sized for one shaping session. `G` is a user/product decision, `R` is primary-source research, `P` is a disposable prototype, and `T` is a prerequisite evidence task.

### Resolved

#### F1 — Product promise and actor-level threat model (`G`)

Resolved 2026-07-16 in the [Content Encryption Trust Contracts](./content-encryption-trust-contracts.md): server-blind E2EE is the Private Vault default; ordinary agent use runs through a trusted broker and durable scoped grants; offline work queues unless the user enrolls an always-on personal or user-cloud broker. Every intentional plaintext reader and egress boundary is named in the actor matrix.

### Open now

#### F2 — Defensible E2EE vocabulary (`R`)

Using current standards and primary security sources, what evidence is required to truthfully say “end-to-end encrypted,” “zero knowledge,” “recoverable,” and “revoked”? What caveats follow when a hosted model, integration, recovery authority, web-delivered client, or enterprise escrow can receive plaintext?

Output: claim-to-evidence matrix; no vendor feature roundup.

#### F3 — Complete plaintext and derived-data inventory (`T`)

Where can user material appear today across SQL, Yjs/collab state, blobs, caches, logs, traces, analytics, audit events, application state, agent run history, staged datasets, exports, source sidecars, notifications, previews, browser storage, backups, and model providers? Record lifetime, reader set, deletion path, and whether each item is primary content, metadata, or derivative.

Output: repository-backed data-flow inventory. This is a hard input to the protected-object schema and relay work; implementation PRs 3–4 may not open without it.

#### F4 — Baseline remediation gates (`T`)

Turn the prior audit into independently verifiable closure criteria for:

- Revocation-safe public/tokenized document delivery through the real CDN.
- Explicit, version-bound extension capabilities enforced server-side.
- Notion authority that cannot expand from one shared document into the owner’s integration.
- Peer-specific A2A identity, audience, subject, and scope rather than global arbitrary-human impersonation.
- A machine-enforced single-tenant invariant or true per-user roots for Local File Mode.
- Private, revocable, inventory-addressable media.
- Indistinguishable inaccessible-versus-nonexistent object behavior.
- A privileged production access inventory that exposes no content or secret values.

Output: one acceptance test and owner (Content, core, deployment) per gate. Implementation PRs 1–2 consume this matrix and may not declare a finding closed without its deployed evidence.

### Product policy resolved; evidence and protocol work remain

#### M1 — Space model and encryption domain (`G`)

Resolved for the Private Vault beta: one personal vault is one top-level encryption, membership, rotation, and recovery domain. Documents, folders, versions, indexes, and supported derivatives belong to that vault. The hosted service may know that opaque objects belong to the same vault but not their user-authored hierarchy. The beta does not support team vaults, cross-vault moves, sharing, or partial subtree rekeying. Object-key hierarchy and algorithm choices remain protocol work, but they may not change this product boundary without reopening the contract.

#### M2 — Protected-field and metadata budget (`G`)

Resolved policy for the Private Vault beta: all user-authored text, names, titles, hierarchy, properties, comments, prompts, tool inputs/results, indexes, previews, summaries, and content-derived media metadata are protected. The hosted plane may retain only authenticated account/workspace identifiers; opaque vault, object, endpoint, and job identifiers; vault membership of opaque objects; endpoint public identity and revocation state; key epochs and wrapped envelopes; ciphertext byte lengths; server receipt timestamps; job lease/retry/health state; and content-free access/disclosure facts. Exact sizes, timing, IP/network logs, and access patterns are admitted leakage in the beta; the beta makes no padding or traffic-analysis-resistance claim. PR 3 must freeze the concrete field names, retention periods, and deletion rules and add a guard that rejects additions outside this allowlist.

#### M3 — Cryptographic architecture (`R`)

After M1/M2, compare maintained and independently reviewed primitives/protocols for content encryption, key wrapping, device identity, recipient discovery, signatures, streaming media, rotation, algorithm agility, and key transparency. Include browser, desktop, mobile, offline, and serverless constraints. Do not invent cryptography.

#### K1 — Login, unlock, and device identity (`G` + `P`)

Resolved product contract: account sign-in proves service identity but never unlocks the vault. The first signed desktop creates it; a new device joins only through approval by an enrolled endpoint or independently held recovery material. The hosted directory cannot authorize a key by itself. Prototype first-key creation, routine unlock, lock-now, session expiry, an untrusted device, second-device enrollment, unexpected-device detection, and removal.

#### K2 — Recovery and enterprise authority (`G` + `R`)

Resolved product contract for the personal-vault beta: enrollment requires verified independently held recovery material or a second recovery-capable device. Agent Native support and organization admins cannot recover plaintext. Losing every enrolled endpoint and recovery path is irreversible. Research and test the concrete recovery-material format and ceremony; enterprise escrow requires a separately named future contract.

#### S1 — Sharing, recipient authenticity, and key envelopes (`R` + `P`)

How are recipient keys authenticated against server substitution? What do pending invites, email mistakes, guests, multiple devices, org membership, and subtree inheritance mean cryptographically? Prototype sharing with the right user, wrong user, new user, and external guest.

#### S2 — Removal, rotation, and history semantics (`G` + `P`)

Define the exact promise when a collaborator or device is removed. Recipients cannot be made to forget plaintext they already received; determine how future access, old history, offline edits, new members, and key epochs behave. Prove it with an offline/removed-member simulation.

#### C1 — Opaque collaborative editing (`R` + `P`)

Determine how encrypted Yjs updates, state vectors, snapshots, compaction, awareness, offline edits, replay/rollback detection, and agent attribution work when the relay cannot decrypt or merge plaintext. Prototype two users, two devices, late join, offline edits, removal, and long-history compaction.

#### Q1 — Private search and databases (`G` + `R` + `P`)

Which search, filtering, sorting, joins, properties, and semantic retrieval are essential? Compare local-only indexes, synchronized encrypted indexes, deliberately leaky indexes, and explicit plaintext modes. Benchmark a representative synthetic `teenylilthoughts` corpus for cold unlock, rebuild, incremental updates, shared data, rotation, and mobile memory.

#### B1 — Encrypted media and derivatives (`R` + `P`)

Design client-encrypted media handles and prove upload, image rendering, progressive audio/video range reads, sharing, revocation, deletion, export, and legacy migration. Decide how thumbnails, metadata extraction, malware scanning, and transcription work without an implicit plaintext backdoor.

#### A1 — Agent trust and disclosure modes (`G`)

Conversational agent access is required. For Private Vault work, the orchestration loop itself runs on the enrolled broker; the hosted framework relays ciphertext and content-free state but is not a plaintext agent runtime. The supported modes are:

- Local/on-device agent and local Content broker.
- Always-on personal or user-controlled cloud broker for background access.
- Persistent organization-managed workspace agent authority.
- A future confidential-computing service only if it is enrolled, attested, revocable, and displayed as a named trusted endpoint with an explicitly narrower trust claim.

For each, define who can read prompts, retrieved passages, tool results, outputs, and retained traces. Preserve ordinary tool use after a one-time or durable grant; reserve per-operation prompts for scope expansion or genuinely high-consequence actions. Resolve the availability triangle explicitly rather than weakening encryption when no trusted endpoint is online.

#### A2 — Agent capability and consent object (`R` + `P`)

Prototype an authorization bound to documents/excerpts, operations, model/provider, duration, output destination, and retention. The user should see what crosses the encrypted boundary before it does; requests for more scope must fail closed and become visible approvals.

#### I1 — Integrations and extensions (`G` + `R` + `P`)

When Notion, Builder, automation, a webhook, transcription provider, or extension receives plaintext, is that explicitly outside E2EE? Decide whether integrations run on trusted clients or require a disclosed server-readable mode. Prototype connection, first disclosure, collaborator-triggered sync, disconnect, and revocation.

#### P1 — Public publishing (`G` + `P`)

Decide whether publishing creates a separate plaintext artifact, publishes a decryption key, or produces a distinct encrypted/public copy. Prototype publish, update, cache, preview, media, unpublish, and republish through the real CDN with honest irreversibility language.

#### D1 — Backup, export, deletion, and migration (`G` + `R` + `P`)

Define independently decryptable export, ciphertext backup, disaster recovery, deletion/crypto-erasure limits, and a synthetic-vault migration drill. Only after that should a disposable copy of `teenylilthoughts` be inventoried for links, frontmatter, attachments, Git history, ignored files, symlinks, BWRB behavior, fidelity, and rollback.

#### V1 — Security claims as executable properties (`T`)

Translate every accepted promise into adversarial tests: wrong recipient, malicious server/key directory, removed offline member, stolen session/device, stale CDN, blob leak, malicious extension, compromised peer app, rollback, recovery attack, integration/provider disclosure, and compromised client update.

#### V2 — Independent assurance and launch claim (`G` + `T`)

Set the evidence bar: protocol publication, threat-model review, cryptographic design review, implementation audit, penetration test, reproducible/signed clients, dependency and update policy, bug bounty, key-rotation/incident drill, and promise-to-UI review. No lock icon gets to freelance as a security specification.

## Provisional build sequence

This is an ordering hypothesis, not authorization to implement:

1. Close the baseline audit and build production access visibility.
2. Freeze the E2EE promise, threat model, metadata budget, and client trust boundary.
3. Prototype one personal encrypted document across two devices, portable export, and recovery.
4. Prototype encrypted sharing, removal, Yjs collaboration, and media.
5. Prototype private search/databases and explicit agent disclosure.
6. Define integrations and public publishing as intentional boundary crossings.
7. Run synthetic-vault migration and complete adversarial/independent review.
8. Ship behind a migration gate; move real personal data only after deployed proof.

An early Private Vault is the selected first product slice. Collaboration, hosted background agents, public publishing, and integrations must fail closed rather than falling back to server plaintext until their explicit grant and disclosure contracts are implemented.

The beta client is the signed Agent Native desktop app. It hosts the broker, vault UI, and vault-scoped agent loop. The hosted browser may show account-level, public, and content-free broker-health surfaces, but it cannot unlock a vault, render protected content, accept a protected prompt, or enqueue a vault request. It fails closed with guidance to open the signed desktop app.

Legacy plaintext Content remains available during the beta as a separately labeled **Standard Cloud** surface. Hosted agents may continue to operate there under the existing server-readable contract. The enrolled-endpoint invariant applies to Private Vault data; Standard Cloud never receives an E2EE badge and cannot be an automatic fallback or migration target for a locked vault.

## Not yet specified

- Whether the first always-on broker package targets personal hardware, a user-controlled cloud deployment, or both.
- The exact grant schemas and first supported egress paths for public publishing, integrations, extensions, automations, and unattended agents.
- Whether team spaces require admin recovery, legal hold, DLP, or eDiscovery.
- Performance budgets, mobile requirements, and the compatibility timeline after the signed-desktop beta.

## Out of scope

- Selecting or implementing cryptographic primitives before the threat model and key-custody decisions.
- Claiming absolute security, “military-grade encryption,” or perfect revocation of plaintext already received.
- Moving any real `teenylilthoughts` data during shaping or prototypes.
- Treating database encryption-at-rest, TLS, customer-managed server keys, or a trusted execution environment as synonymous with E2EE.
- Building generic E2EE for every Agent-Native template before the Content product contract and protocol have survived review.
- Compliance certification work before the underlying security properties exist.

## Work handoff

Begin with the production exposure inventory and F3/F4 evidence matrix, then write the exact M2 field/retention table consumed by PR 3. The policy decisions are settled; work should refine them into executable schemas and tests rather than reopening server-held keys, hosted plaintext agent loops, or mutable-browser vault access.
