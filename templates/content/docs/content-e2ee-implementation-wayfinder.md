# Content E2EE Implementation Wayfinder

Status: implementation brief complete; repository-backed F3/F4 evidence, public preflight, and credentialed deploy provenance complete; configuration inventory and deployed proof pending
Decision date: 2026-07-16
Trust contract: [Content Encryption Trust Contracts](./content-encryption-trust-contracts.md)
Security map: [Content Security and E2EE Wayfinder](./content-security-e2ee-wayfinder.md)
Baseline audit: [Content Data-Isolation Audit](./content-data-isolation-audit-2026-07-13.md)
F3/F4 evidence: [Content E2EE F3/F4 Evidence Matrix](./content-e2ee-f3-f4-evidence-matrix.md)
Production preflight: [Content Production Exposure Inventory Preflight](./content-production-exposure-inventory-2026-07-16.md)
Cross-app direction: [Agent Native E2EE Expansion Strategy](./agent-native-e2ee-expansion-strategy.md)

## Answer

The E2EE feature can arrive as a single **upstream production pull request** if a long-lived fork acts as the integration environment. Two baseline isolation PRs must land upstream first rather than waiting behind that fork; they fix current trust-boundary findings and are prerequisites, not pieces of the E2EE feature delivery envelope. The E2EE work still needs sequential milestone PRs, review gates, synthetic deployments, and independent assurance inside the fork; the final upstream PR becomes the delivery envelope rather than the only review event.

The minimum responsible route to a new-vault **Private Vault beta** is:

- One existing shared-feature-flags prerequisite.
- Two baseline security PRs landed upstream and synchronized into the fork.
- Six sequential E2EE milestone PRs (PRs 3–8 below) into the fork's integration branch.
- One milestone PR open and under active review at a time.
- One final upstream PR containing the preserved, reviewed milestone history.
- Independent cryptographic design review before the product makes an E2EE claim.

Full Notion-like encrypted parity and Always-on Personal Automation are later stacks. The likely total is **twelve to fourteen PRs**, depending on what a real `teenylilthoughts` inventory proves it needs. The vault should not move at the first beta milestone.

This preserves one upstream PR for the E2EE feature, not literally one upstream PR for every security correction discovered along the way. The fork supplies the missing sequence and evidence. The final upstream diff will still be massive, but every important boundary will already have a named commit range, test record, and reviewer decision.

## Why one undifferentiated implementation does not work

Content's server is currently the plaintext execution engine, not merely a storage layer:

- Canonical document titles and bodies live in plaintext SQL; versions, comments, properties, source rows, execution payloads, and block fields duplicate or derive from them (`server/db/schema.ts`).
- List and search calculate previews, lengths, `LIKE` matches, and snippets on the server (`actions/list-documents.ts`, `actions/search-documents.ts`).
- The collaboration plugin binds Yjs directly to `documents.content`; core stores base64 Yjs state and a plaintext snapshot (`server/plugins/collab.ts`, `packages/core/src/collab/storage.ts`).
- Public rendering, Notion/Builder sync, transcription, export, source federation, and media handling all consume plaintext on the server.
- The code search found roughly 94 production modules in the combined plaintext path, including 63 actions, 10 app modules, and 21 server modules. At least 37 production modules directly reference `schema.documents`.

The framework also lacks one universal protected-action execution seam:

- Hosted agent tools execute action entries inside `packages/core/src/agent/production-agent.ts`.
- Browser and HTTP calls execute through `packages/core/src/server/action-routes.ts`.
- MCP and agent teams invoke action entries through their own paths.
- Hosted run events, dispatch payloads, and tool ledgers persist server-readable workflow material.
- Application state stores ordinary JSON in SQL.
- Jobs and triggers construct hosted model prompts from server-readable bodies.
- Core private blobs use a deployment-held server secret and may decrypt on the server; they are encryption at rest, not user-held-key E2EE.
- Automatic audit records redacted-but-plaintext inputs by default and is best-effort rather than tamper-evident.

Adding a broker proxy to one Content route would therefore leave other action and agent surfaces able to bypass it. Encrypting one column would leave many other plaintext copies. A template-only flag would put a tasteful curtain in front of the server while leaving the server in the room.

## Target implementation shape

Execution remains **split**:

```text
Chosen agent or Content UI
          |
          | existing Content action vocabulary
          v
Reusable trusted broker runtime
  - key custody and device identity
  - encrypted local store and private index
  - protected action execution
  - local/user-cloud agent loop
  - standing grant enforcement
  - signed disclosure log
          |
          | ciphertext, opaque ids, admitted metadata
          v
Agent Native hosted framework
  - authentication and endpoint registry
  - ciphertext SQL/blob sync
  - opaque queue, claim, retry, and health state
  - encrypted or content-free disclosure envelopes
```

The same headless broker runtime must support both placements:

- Agent Native Desktop supervises it locally, stores device secrets through the OS trust boundary, and exposes a narrow authenticated IPC surface.
- A later personal-node or user-cloud package runs the identical broker independently for Always-on Personal Automation.

The browser and agents keep using named Content actions. A broker-aware execution resolver chooses where a protected action runs. Components, MCP hosts, and agents must not learn a second localhost-only API vocabulary.

## One upstream PR through an integration fork

The viable operating model is:

```text
upstream/main
    |
    | continuously synchronized
    v
Alice-owned fork integration branch
    |
    |-- E2EE milestone PR 3 + gate
    |-- E2EE milestone PR 4 + gate
    |-- ...
    |-- milestone PR 8 + independent review
    v
exact reviewed integration SHA
    |
    | mirrored without modification to one upstream branch
    v
one upstream production PR
    |
    | official CI + official preview + final diff/claim review
    v
merge disabled by default -> synthetic canary -> exact-account beta
```

The fork changes the GitHub delivery shape, not the security dependency graph. Its internal PRs are E2EE review units 3–8 below; baseline units 1–2 have already landed upstream and are synchronized into its base. Preserve milestone commits and merge records; do not squash the integration branch into one inscrutable commit before returning upstream.

### Fork branch discipline

- Base the fork on a recorded upstream SHA and continuously merge or otherwise reconcile current `upstream/main`; do not wait until the end for a heroic conflict festival.
- Use one fork integration branch as the target for each milestone PR. The fork may use its `main` branch so the repository's current `pull_request: branches: [main]` CI triggers without changing upstream workflow files solely for the fork.
- Re-run all earlier E2EE gates whenever an upstream sync changes core action execution, auth, audit, jobs, collaboration, blobs, desktop, or Content schema/action paths.
- Preserve milestone commits and signed review evidence. The final upstream PR should be reviewable by commit range even though its aggregate Files view is large.
- Freeze new feature work during the final upstream sync, assurance rerun, and exact-SHA handoff.

### Fork CI and infrastructure requirements

Ordinary lint, typecheck, unit, Content parity, Content DB, core integration, guards, and builds can run in the fork. Secret-bearing infrastructure cannot simply be inherited:

- GitHub does not expose upstream repository secrets to code running from a fork.
- The Neon preview workflow explicitly runs only when the PR head repository equals the repository receiving the PR.
- The checked-in Neon project and Netlify site identifiers belong to upstream infrastructure and must never be targeted with fork credentials.
- Desktop signing/notarization credentials and hosted-provider keys also remain upstream-only.

The fork therefore needs:

- Fork-owned synthetic Neon/database, blob, CDN, scheduler, and deployment targets with no customer or personal data.
- Fork-owned test credentials and obviously synthetic accounts.
- A dedicated E2EE adversarial CI lane, including database/blob/log known-plaintext scans and broker-offline tests.
- A test signing root and built desktop/broker artifacts sufficient to exercise signature pinning and malicious-update cases. Official production signing happens only after the exact SHA reaches upstream infrastructure.
- External model/integration tests configured to retain no real vault data and to use synthetic fixtures only.

### Exact-SHA upstream handoff

Opening the final PR directly from the fork would run ordinary upstream CI, but official Neon/Netlify preview provisioning is intentionally skipped for fork heads. The safer final handoff is:

1. Complete internal review and assurance against one immutable fork integration SHA.
2. Push or mirror that exact commit graph to a single upstream integration branch without rebuilding, squashing, or modifying it.
3. Verify the upstream branch head equals the reviewed SHA.
4. Open one same-repository PR to `main`; this enables the official preview/database workflow and secret-bearing checks.
5. Treat any fix made during upstream review as a new fork milestone: land it through the same internal review path, mirror the new exact SHA, and rerun affected assurance.

The final upstream PR is therefore one production PR, while the fork retains the smaller internal PRs as its audit trail.

### What the fork model does not solve

- It does not make a huge final diff pleasant to browse.
- It does not make irreversible migrations roll back with `git revert`.
- It does not remove the need for independent protocol and implementation review.
- It does not protect the fork from drifting away from rapidly changing core code.
- It does not make dormant code safe to enable merely because the final PR merged.
- It does not justify holding known current cross-user fixes for months if the hosted app already contains meaningful user data.

The last point is the required exception to the one-upstream-PR rule: baseline CDN/media and authority-isolation fixes land upstream as PRs 1–2 before the long E2EE fork. A read-only production exposure inventory runs immediately to establish blast radius and urgency, but a quiet inventory does not waive the fixes. The merged upstream commits are synchronized into the fork and disappear from the final E2EE diff.

### What one unstructured PR could safely mean

One feature-gated PR could demonstrate:

- One new synthetic encrypted vault.
- One encrypted document with title and body.
- One enrolled local broker.
- Create, list, get, edit, and tiny private-search actions through the normal action names.
- One standing agent grant.
- Encrypted queueing while the broker is unavailable.
- An independently decryptable synthetic export.
- Hard failure for comments, databases, collaboration, media, publishing, integrations, import, and real-data migration.

Without the fork's internal milestone reviews and evidence, that would be only a prototype, not a shippable trust contract. The integration-fork model is what permits the aggregate implementation to arrive upstream as one PR without pretending it was created or reviewed in one gulp.

### Why the implementation needs several PRs

The production route contains independently reversible layers:

1. Current cross-user vulnerabilities must close immediately rather than waiting behind a long E2EE branch.
2. The action-execution and ciphertext protocols are reusable framework contracts that need review without Content UI noise.
3. The broker and signed desktop trust anchor have a different runtime, release, and attack surface from the hosted app.
4. Content adaptation is the first user-visible vertical slice and should be reviewable against already-settled lower layers.
5. Migration and legacy-plaintext deletion are irreversible data ceremonies and need their own rollback proof.
6. Release claims and canary enablement depend on deployed and independent evidence, not merely passing unit tests.
7. Always-on automation adds a new continuously trusted endpoint and deployment artifact; it is a separate product contract.

Repository history proves that Git can mechanically merge very large PRs. That is not the same as proving a cryptographic boundary. The useful concession to the single-PR preference is **one active PR at a time**, a linear dependency chain, and no swarm of half-landed stacks.

## Recommended internal fork PR stack to Private Vault beta

The estimates are planning ranges, not commitments. They include implementation and first-party verification but exclude time introduced by external findings.

### Prerequisite — Shared feature flags

Land or rebase the existing shared-feature-flags work before E2EE implementation. Encryption enrollment uses exact user/org targeting, not percentage rollout.

Required behavior:

- Separate gates for enrollment, migration, and later always-on access.
- Vault cryptographic mode persists on the vault; a server flag cannot toggle a migrated vault between plaintext and ciphertext.
- Disabling a flag blocks new enrollment or migration and causes protected work to lock or queue. It never routes to the legacy plaintext path.
- Operational kill means “stop decrypting/disclosing,” not “use the old implementation.”

### Entry-gate map

| Gate | Must be complete before | Required output |
| --- | --- | --- |
| Production exposure inventory | PR 1 opens | [Unauthenticated content-free preflight complete](./content-production-exposure-inventory-2026-07-16.md); credentialed visibility/grant counts, effective deployment configuration, provider IAM/retention, and disposable CDN/media proof remain pending |
| F3 plaintext and derivative inventory | PR 3 opens | [Repository evidence complete](./content-e2ee-f3-f4-evidence-matrix.md#f3--plaintext-and-derivative-inventory); production readers, retention, backups, and deletion proof remain pending |
| F4 remediation matrix | PR 1 opens | [Repository matrix complete](./content-e2ee-f3-f4-evidence-matrix.md#f4--baseline-remediation-evidence-matrix); implementation and deployed adversarial proof remain pending |
| M1 personal-vault domain | PR 3 opens | The settled one-vault domain contract reflected in schema invariants |
| M2 protected-field and metadata budget | PR 3 opens | Exact hosted-field allowlist, retention/deletion table, admitted size/timing/access-pattern leakage, and schema guard |
| M3 cryptographic architecture | PR 4 opens | Reviewed design record selecting maintained, independently reviewed primitives/libraries for object encryption, key wrapping, device authentication, streaming, rotation, versioning, and algorithm agility, with fixed interoperability and failure vectors; no home-grown cryptography |
| K1 device identity and enrollment | PR 5 opens | Existing-device or recovery-mediated enrollment ceremony; server directory cannot add a device alone |
| K2 recovery | PR 5 opens | Verified recovery-material format and lost-all-paths behavior; no Agent Native recovery key |
| Signed desktop and agent-loop placement | PR 5 opens | Desktop-only private-vault client; vault-scoped agent loop runs on the enrolled broker |

The product decisions behind these gates are settled in the trust contract. The listed outputs refine them into executable schemas, ceremonies, and tests; they do not reopen vendor key escrow, hosted plaintext agent loops, or browser vault access. PR 3 may define versioned opaque envelope schemas and failing vectors, but PR 4 may not implement encryption or key custody until M3 has passed focused cryptographic design review.

### PR 1 — Baseline delivery and media isolation

Scope:

- Revocation-safe public/tokenized document delivery through the real CDN.
- Preserve the core invariant that SSR HTML and React Router `.data` responses are one impersonal, public, shared-cache shell. Remove document titles/bodies and token-authenticated content from the Content route loader entirely.
- Deliver public or tokenized document data through a named access-checked action/client helper outside the SSR shell. Tokenized responses are non-shared and non-cacheable; public data uses revocation-safe delivery with deployed purge/refetch proof.
- Add a Content regression guard proving the SSR loader never returns user document material, and rerun the existing core SSR-shell tests unchanged. A Core changeset is required only if a reusable helper must be added, not to weaken the shell contract.
- Private, inventory-addressable media with revoke/delete behavior.
- Inaccessible-versus-nonexistent parity.
- Two-account delivery and media tests.

Entry evidence:

- Complete the credentialed phase of the [production exposure inventory](./content-production-exposure-inventory-2026-07-16.md), including content-free counts and disposable media/CDN proof; do not treat the safe preflight as gate closure.
- Confirm the deployed media provider's anonymous-read behavior with a disposable asset before choosing the remediation path.

Exit gate:

- A public-to-private transition and token expiry no longer serve stale content through the deployed CDN.
- A revoked media handle stops serving protected bytes.

Estimated size: 15–30 files; 1–2 engineer-weeks.

### PR 2 — Baseline authority isolation

Scope:

- Remove owner-Notion confused-deputy authority from ordinary document editors.
- Add explicit, version-bound extension capabilities and egress consent.
- Define backward compatibility for existing extensions: old grants default to viewer-safe/no-egress behavior and require an explicit capability upgrade rather than being silently grandfathered.
- Replace shared-secret arbitrary A2A identity assertion with peer-specific bounded trust.
- Enforce Local File Mode as single-tenant by construction or refuse unsafe hosted configuration.
- Add the operator-authorized, non-public, non-agent-callable `production-privacy-inventory` aggregate action specified by the [production preflight](./content-production-exposure-inventory-2026-07-16.md). Before PR 1, close the immediate inventory gate with an equivalent reviewed one-off read-only report; PR 2 makes that contract reusable and audited.
- Install dependencies and rerun `pnpm action db-check-scoping --format json`; retain the output with the PR evidence.

Exit gate:

- Each prior audit finding has one deployed adversarial test and an explicit owner.

Estimated size: 20–40 files; 2–3 engineer-weeks.

### PR 3 — Executable protocol contract and failing corpus

Scope:

- Consume the completed F3 inventory, M1 vault-domain contract, and exact M2 hosted-field/retention allowlist.
- Define stable schemas for encryption domains, endpoint identity, key epochs, capability grants, disclosure envelopes, ciphertext objects, opaque revisions, and queued jobs.
- Define and enforce the reusable resource privacy manifest: protected fields, execution placement, admitted metadata, egress, and fail-closed features.
- Add a schema/CI guard that rejects protected-object hosted fields outside the M2 allowlist.
- Add fixed known-plaintext, wrong-recipient, replay, rollback, removed-device, corrupted-envelope, broker-offline, and metadata-leak fixtures.
- Introduce a universal action-execution resolver and capability-bearing invocation context with behavior unchanged for existing apps.

Exit gate:

- Every trust-contract claim maps to an executable property before cryptographic runtime code exists.
- HTTP, frontend, CLI, hosted agent, MCP, A2A, agent-team, and job invocation paths all pass through the same resolver or an equivalently proven registry transformation.

Estimated size: 15–30 files; 2–3 engineer-weeks.

### PR 4 — Ciphertext relay and opaque hosted plane

Scope:

- Additive encrypted-vault, endpoint, key-envelope, grant, disclosure, object, and job tables.
- Ciphertext object/blob upload, retrieval, versioning, deletion, and opaque sync events.
- Opaque job enqueue, broker claim, acknowledgement, retry, cancellation, and encrypted result envelopes.
- Named client methods; no component-owned raw routes.
- Central enforcement that protected action inputs/results never enter ordinary audit, application state, logs, analytics, hosted run events, dispatch payloads, or tool ledgers.
- Segregate protected ciphertext objects from the legacy `private-blob` namespace and its server-held decrypt API; no legacy helper may accept a protected-object handle.

Exit gate:

- A dump of SQL, blobs, event streams, audit, job queues, and logs contains no synthetic protected plaintext or decryption key.
- Hosted code has no decrypt API for protected objects.

Estimated size: 25–45 files; 3–4 engineer-weeks. Core changes require a changeset.

### PR 5 — Reusable broker and signed desktop trust anchor

Scope:

- Headless broker package with key custody, encrypted local store, private index, action execution, local agent loop, grant checks, offline queue, revocation checks, and signed/tamper-evident disclosure sequencing.
- Vault-scoped agent orchestration runs inside the broker. Hosted Agent Native services may relay encrypted jobs and disclose content to a user-approved external model, but never hold the vault tool loop's plaintext state or retained transcript.
- Desktop main-process lifecycle, OS-backed key storage, narrow authenticated IPC, software identity/version checks, enrollment, health, lock, and removal.
- Synthetic create/unlock/lock, second-device, removal, recovery, malicious key-directory, stolen-session, and update-integrity tests.

Exit gate:

- The hosted web bundle cannot request arbitrary vault plaintext through a broad preload bridge.
- The broker is independently packageable and relocatable; it is not coupled to a development command or Alice's current machine staying online.

Estimated size: 25–50 files; 3–5 engineer-weeks.

### PR 6 — Feature-gated Content Private Vault vertical slice

Scope:

- New encrypted vault creation only; no existing-data migration.
- Document/folder create, list, get, edit, move, delete, and private search through existing Content action names.
- Encrypted versions sufficient for safe edits and rollback of the supported slice.
- UI for vault creation, unlock/lock, broker health, endpoints, standing agent grants, disclosure activity, queue state, and revocation.
- Deliver the private-vault UI only inside the signed desktop client. Hosted browser routes show a locked/content-free status and direct the user to desktop; they cannot accept vault prompts or enqueue protected work.
- UI/actions/agent instructions/application state parity.
- Content application state contains only opaque navigation/resource ids and admitted status metadata.
- Unsupported comments, databases, collaboration, public publishing, integrations, extensions, source federation, and media operations fail closed with precise guidance.

Exit gate:

- A user and their chosen agent can complete the same supported workflows.
- Broker-off work queues; it never reaches hosted plaintext execution.
- Two synthetic devices synchronize encrypted documents without the hosted plane learning their titles or bodies.

Estimated size: 40–70 files; 4–6 engineer-weeks.

### PR 7 — Migration, export, recovery, and rollback

Scope:

- Explicit, idempotent, resumable per-vault migration with preflight and a durable ledger.
- Per-object ciphertext verification before cutover.
- Independently decryptable export.
- Recovery and failed-cutover drills.
- Deliberate legacy-plaintext cleanup ceremony and backup-retention disclosure.
- No destructive startup migration and no production `drizzle-kit push`.

Exit gate:

- A synthetic legacy vault migrates, verifies, exports, recovers, resumes after interruption, rolls back before cleanup, and proves what remains in backups.
- A vault does not receive the E2EE label while recoverable plaintext copies still exist in hosted storage or retained backups.

Estimated size: 20–40 files; 3–4 engineer-weeks.

### PR 8 — Release hardening and exact-target beta

Scope:

- Dedicated E2EE vector, adversarial, database, built-client, and browser QA jobs in CI.
- Signed/verifiable client artifact checks rather than only testing a mutable dev web bundle.
- Preview and production canary runbook using synthetic users and exact-account enrollment.
- Claim-to-evidence review, incident/rotation drill, and archived production evidence.
- In-product disclosure that beta ciphertext lengths, timing, network logs, and opaque access patterns remain visible; make no padding or traffic-analysis-resistance claim.
- Independent cryptographic design and implementation review findings.

Exit gate:

- The beta is enabled only for exact synthetic/test accounts first.
- Every launch property has unit/vector, integration/adversarial, and deployed evidence where relevant.
- The changelog says experimental Private Vault beta and names unsupported workflows; it does not claim zero knowledge.

Estimated size: 10–25 files; 1–2 engineer-weeks, plus roughly 2–4 weeks for external review and findings.

### First-beta total

- Eight implementation review units: two baseline security PRs landed upstream, six E2EE milestone PRs inside the fork, plus the existing feature-flag prerequisite and one final upstream E2EE PR.
- Roughly 18–28 engineer-weeks before external-review findings.
- Calendar time can shrink through parallel research and implementation ownership, but the PRs should land in dependency order and one active review at a time.

## Post-beta parity stack

Private Vault beta intentionally proves the trust kernel before reproducing every Notion-like feature. Later PR boundaries should follow these plaintext-compute domains:

### PR 9 — Encrypted versions, comments, and anchoring parity

- Full encrypted history, restore, comments, quoted anchors, mentions, and content-free collaboration metadata.

### PR 10 — Encrypted sharing and opaque collaboration

- Verified recipient devices, wrapped keys, epochs, removal/rotation, encrypted Yjs updates/checkpoints, late join, offline edits, replay protection, and compaction.

### PR 11 — Private databases and search parity

- Encrypted property definitions/values, view state, private incremental indexes, formulas, filters, sorts, grouping, joins, rollups, and performance budgets.

### PR 12 — Encrypted media and derived data

- Client/broker encryption before upload, opaque handles, chunk/range reads, thumbnails, transcription policy, revocation, export, and deletion.

### PR 13 — Publishing and integration egress

- Separate public artifacts and explicit grants for Notion, Builder, transcription, provider APIs, extensions, webhooks, and source federation.

### PR 14 — Always-on Personal Automation

- Package the same broker for personal nodes and user-controlled cloud accounts.
- Enroll it like a device with collection/task subkeys, opaque hosted scheduling, grant revalidation, health, missed-run reporting, disclosure evidence, and revocation.
- Do not introduce a second cloud-only broker implementation.

Some parity PRs may split after their prototype exposes a larger review boundary. They should not be compressed merely to keep the final number aesthetically pleasing.

## `teenylilthoughts` migration gate

Real vault migration is not authorized at Private Vault beta. After PR 8:

1. Inventory a disposable copy of `teenylilthoughts`: Markdown/MDX, frontmatter, links, attachments, ignored files, symlinks, Git history, BWRB behavior, databases/properties, and external integrations.
2. Map each required feature to the supported encrypted surface.
3. Land the necessary parity PRs—likely private databases/search and encrypted media, but the inventory decides.
4. Run migration, recovery, export, deletion, and rollback drills on the disposable copy.
5. Move real data only after deployed proof and an explicit go/no-go decision.

Always-on Personal Automation is not a prerequisite for moving the vault. Queue-until-wake is the safer initial contract.

## Migration and rollback rules

- All database changes are additive. Current plaintext columns remain intact during prototype and migration development.
- New migrations use unique names in `server/plugins/db.ts`; no version reuse.
- New encrypted vaults and legacy plaintext documents remain distinguishable by persisted cryptographic mode, not an ephemeral feature flag.
- No mass conversion occurs at deploy or startup.
- Migration actions are atomic at the object/checkpoint level, idempotent, resumable, and independently verifiable.
- Code rollback must leave ciphertext readable by a compatible prior broker or lock safely. It must never restore plaintext server execution.
- Legacy plaintext deletion requires an explicit user ceremony after export and recovery proof. Backups receive honest retention language.
- Turning off enrollment or migration does not turn off decryption for already-enrolled vaults unless an emergency kill is deliberately invoked; emergency kill locks rather than downgrades.

## Verification matrix

Every property needs three levels where applicable:

| Property | Unit/vector | Integration/adversarial | Deployed evidence |
| --- | --- | --- | --- |
| Server blindness | Known-plaintext and key-search fixtures | SQL/blob/log/audit/job dump | Real preview/prod storage inspection |
| Device and recipient identity | Signature/envelope vectors | Malicious directory and wrong-recipient tests | Enrolled-device ceremony |
| Agent grants | Scope/provider/expiry/revocation tests | Scope expansion and stale-grant attempts | User-visible grant and disclosure audit |
| Offline failure | Queue state machine tests | Broker killed mid-operation | Missed/queued run in built client |
| Rotation and removal | Epoch/replay vectors | Removed offline device and stale write | Two-device canary |
| Private indexes | No-plaintext-cache assertion | Search/database corpus coverage | Cold rebuild and incremental benchmark |
| Egress | Disclosure-schema tests | Model/integration/public boundary tests | First-disclosure and revoke UI proof |
| Migration/recovery | Idempotency and corruption vectors | Interrupted cutover/export/recovery | Synthetic vault drill |
| Client integrity | Artifact/signature tests | Malicious update/channel simulation | Built signed-client verification |
| Revocation | ACL/key-epoch tests | Public-to-private and media leak tests | Real CDN/provider fetch after revoke |

Content currently has strong unit and DB coverage but only two browser E2E specs, and its fast suite excludes DB, integration, E2E, live, and performance tests. E2EE therefore needs a dedicated CI lane rather than hiding inside `test:fast`.

## Execution and review operating model

To honor the preference for one production PR without weakening the security boundary:

- Keep one source-of-truth implementation map.
- Open only the next fork milestone PR; do not maintain a six-PR speculative stack.
- Merge each reviewed foundation into the fork integration branch before starting its dependent diff where practical.
- Use small, ordered commits inside each PR so reviewers can inspect protocol, implementation, tests, and UI separately.
- Keep every PR default-off or behavior-preserving until the Content vertical slice.
- Synchronize upstream frequently; do not let the E2EE fork become an unrelated private version of core.
- Attach proof artifacts and exact failing/passing security properties to each PR.
- Do not count “merged behind a flag” as “safe to enable.”

## Ready-to-work boundary

The brief is complete enough to enter `/work`. The repository F3/F4 pass and unauthenticated production preflight are complete, but the credentialed production exposure inventory remains a PR 1 entry gate. After that gate closes, work lands baseline PRs 1–2 upstream. Before implementation PR 3 opens, the team converts the settled M1/M2 policies into the exact field, retention, and deletion tables required by the entry-gate map. Before PR 4 opens, M3 selects and reviews the cryptographic architecture. Before PR 5 opens, the team converts the settled device and recovery contracts into executable ceremonies and vectors.

Those are named deliverables inside the work plan, not unresolved product forks. If an implementation finding would require server-held recovery keys, hosted plaintext vault-agent loops, browser vault access, a broader metadata allowance, or a plaintext fallback, work stops and returns to shaping.

## Out of scope for the first implementation stack

- Moving real `teenylilthoughts` data.
- Always-on personal or user-cloud execution.
- Organization-managed recovery or enterprise escrow.
- Hardware-isolated vendor execution.
- Claims of zero knowledge or audited E2EE before independent evidence exists.
- Generic E2EE retrofits for every Agent Native template.
- Destructive replacement of current plaintext schema or automatic production migration.

## Decision

Complete the credentialed phase of the [production exposure inventory](./content-production-exposure-inventory-2026-07-16.md) and land baseline security PRs 1–2 upstream. Then use an integration fork for six sequential E2EE milestone PRs with one active review at a time, and mirror the exact reviewed commit graph into one same-repository upstream E2EE production PR. This preserves one-PR delivery for the E2EE feature without holding known isolation fixes hostage to it. Keep the final merge disabled until official previews, independent assurance, synthetic canaries, and exact-account rollout succeed.
