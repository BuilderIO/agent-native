# Content E2EE Implementation Wayfinder

Status: implementation active on the isolated fork; baseline isolation, executable protocol contracts, cryptographic design, the opaque hosted ciphertext plane, and an account-authorized first-device genesis through trusted native UI and narrow Content IPC have executable proof; endpoint enrollment/recovery, complete broker packaging, and the product slice remain pending
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

### Provisioned fork lab — 2026-07-16

The first isolated integration environment is operational:

| Surface             | Current fork-lab state                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository          | `3mdistal/agent-native`, development branch `codex/content-e2ee-foundation`; clean source commit `2ce59e4ed` includes the universal protected execution seam, opaque hosted plane, authenticated retention scheduler path, and migration/provider cold-start barrier             |
| Vercel              | Project `agent-native-content-e2ee-lab` (`prj_wO5idRekc7toiCNQuHXH2zxawCvp`), connected to the fork, Node 24, root directory `templates/content`, explicit build command `NITRO_PRESET=vercel AGENT_NATIVE_MODE=database pnpm build`                                             |
| Stable URL          | `https://agent-native-content-e2ee-lab.vercel.app`; verified custom lab domain `https://content-e2ee-lab.bwrb.dev`                                                                                                                                                               |
| Verified deployment | Production deployment `dpl_5xzAPSNsRXpeLCmesHnw4Re94rP6` serves the stable aliases and passed the authenticated retention-scheduler proof. It contains the temporary content-free auth diagnostic used to isolate the outer-session-guard fault; clean source is already pushed. |
| Git deployment      | Exact-archive preview `dpl_CXwENm12JVfBrwpdM9wuJ4LWEHbn` built commit `15b67184f` on Vercel Linux/x64 and reached Ready; its cold start bound the intended protected-ciphertext generation digest in Neon                                                                        |
| Neon                | Fork-only Neon project `curly-grass-81173036`, Vercel Marketplace resource `store_6SY2k3ZIus8VEFka`, region `iad1`, connected to production, preview, and development environments                                                                                               |
| Private blob        | Fork-only Vercel Blob store `content-e2ee-private` (`store_eaA1h4cPWgMjvRFM`), private access, region `iad1`, connected to production, preview, and development environments                                                                                                     |
| Runtime secrets     | Independent generated values for Better Auth, scoped-secret encryption, and A2A in each environment; values were never copied into source or documentation                                                                                                                       |
| Runtime mode        | Database mode with Neon-backed migrations and content-free health reporting; serverless ffmpeg target pinned to `x64` for Vercel-hosted builds                                                                                                                                   |

The deployed smoke and isolation proof passed:

- A genuinely cold `GET /_agent-native/auth/session` returned `200` with an unauthenticated envelope after auth initialization was added to the framework readiness gate. `GET /_agent-native/sign-in` returned the framework login HTML on its first request.
- `GET /_agent-native/health` returned `200` with `ok`, `ready`, and database connectivity true.
- Anonymous `GET /_agent-native/actions/list-documents` returned `401` with no document data.
- Synthetic account A created private page `YF7URVpwJLF6`, titled `QA A Private Canary`.
- Synthetic account B's private list was empty and direct navigation to A's page returned the in-app `Document unavailable` boundary. The account B UI exposed neither A's title in its tree nor A's document body.
- A disposable private-blob probe returned `403` to an anonymous direct URL read, round-tripped byte-for-byte through an authenticated read, and returned not found to an authenticated read after deletion. The probe object was deleted; only status and digest evidence were retained.
- `AUTH_SKIP_EMAIL_VERIFICATION` was enabled only long enough to create the synthetic QA accounts, then removed before the final deployment. It is absent from the settled production environment.

The PR 4 hosted-plane proof also passed against exact-archive preview
`dpl_FgSamYDVK92FtemyammmUBW3wqKD`:

- The first health request waited for migrations v73-v78 and the immutable
  provider binding before returning `200`. An earlier rehearsal deployment
  exposed the opposite ordering as a fatal cold-start race; the shared
  migration barrier fixed that reproduced failure, and the corrected runtime
  emitted no fatal or error log entries.
- A disposable authenticated account and synthetic vault uploaded 106 bytes
  produced locally with the frozen `anc/v1` XChaCha20-Poly1305 wrapper. The
  hosted response returned content-free metadata only; a later GET returned
  byte-identical ciphertext, the local client decrypted the original private
  sentinel, and the ciphertext itself did not contain the sentinel.
- A bounded scan covered 19 relevant Neon tables and 54 rows: every
  `content_encrypted_vault_*` table plus `agent_audit_log`,
  `application_state`, `resources`, and `settings`. Neither the private
  plaintext sentinel nor the local key appeared. The six runtime log entries
  for registration, login, session, health, upload, and download also contained
  neither value and had zero fatal/error entries.
- Deletion changed the object to its terminal state and transactionally queued
  retention. After evidence capture, the Blob object was absent and the lab was
  asserted to contain only the disposable vault before nine scoped synthetic
  hosted rows and the no-longer-referenced binding were removed. A fresh
  target-specific deployment then recreated exactly one binding whose digest
  matched the one-use local generation value without printing that value.
- The platform retention route initially returned `401` before reaching its own
  bearer check because Content's global user-session guard covered every
  `/api/*` route. The settled auth configuration exempts only the exact
  `/api/private-vault/retention/run` path; the broader Private Vault prefix
  remains session-protected. No bearer and a wrong bearer both returned `401`.
  The one-use 256-bit bearer returned `200`, `Cache-Control: no-store`, and only
  zero-valued cleanup counts. Vercel's platform cron runner then invoked the
  same exact production deployment and its runtime log recorded `200` at
  `2026-07-17T01:11:10.371Z`.

This proves the fork lab, authentication, Neon persistence, and the exercised document read boundary. It does **not** prove E2EE, privileged-operator blindness, every Content resource type, or complete cross-user isolation. The existing F3/F4 matrix and adversarial suite remain mandatory.

Open lab gaps before E2EE milestone PR 3:

- Connect a synthetic-only agent engine; the current status endpoint reports `configured: false`, so document storage/auth can be tested but agent runs cannot yet be included in the lab evidence.
- The fork-owned scheduler is registered for
  `/api/private-vault/retention/run` at `0 3 * * *` UTC and has an authenticated
  production invocation. The clean source commit that removes the temporary
  content-free diagnostic is waiting only for Vercel's 100-deploy Hobby API
  limit to reset; it does not change the proven auth or retention behavior.
- Triage the remaining 79 non-strict `agent-native doctor` findings emitted by the Content build. The three findings introduced by the opaque hosted plane are explicitly resolved; the older findings are still a separate noisy-build gap and must not be mistaken for a clean security signal.

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

| Gate                                    | Must be complete before | Required output                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production exposure inventory           | PR 1 opens              | [Production content-free preflight complete](./content-production-exposure-inventory-2026-07-16.md). The fork lab now has an audited operator-only aggregate inventory plus disposable CDN and private-provider proof; production visibility/grant counts and provider IAM/retention still require production operator access before upstream rollout.                                                              |
| F3 plaintext and derivative inventory   | PR 3 opens              | [Repository evidence complete](./content-e2ee-f3-f4-evidence-matrix.md#f3--plaintext-and-derivative-inventory); production readers, retention, backups, and deletion proof remain pending                                                                                                                                                                                                                           |
| F4 remediation matrix                   | PR 1 opens              | [Repository matrix complete](./content-e2ee-f3-f4-evidence-matrix.md#f4--baseline-remediation-evidence-matrix); public/private delivery, short-token expiry, operator inventory, private-provider behavior, document-media deletion, and cross-account document isolation have deployed fork proof. Two-account media share revocation, Notion OAuth, extension, A2A, and exhaustive existence-parity proof remain. |
| M1 personal-vault domain                | PR 3 opens              | [Versioned domain schema and Content contract frozen](./content-e2ee-m1-m2-executable-contract.md); storage invariants arrive in PR 4.                                                                                                                                                                                                                                                                              |
| M2 protected-field and metadata budget  | PR 3 opens              | [Exact hosted-field allowlist, leakage budget, retention/deletion table, Content manifest, and structural rejection guard frozen](./content-e2ee-m1-m2-executable-contract.md).                                                                                                                                                                                                                                     |
| M3 cryptographic architecture           | PR 4 opens              | [Frozen design and unconditional independent-review GO complete](./content-e2ee-m3-cryptographic-design.md): exact `anc/v1` suite, deterministic canonical encoding, 14 fixed known-byte envelopes, native/WASM parity, malicious-relay harness, and executable ceremony transcripts. Runtime proof adapters and authenticated durable replay remain PR 5 implementation requirements, not open design decisions.   |
| K1 device identity and enrollment       | PR 5 opens              | Existing-device or recovery-mediated enrollment ceremony; server directory cannot add a device alone                                                                                                                                                                                                                                                                                                                |
| K2 recovery                             | PR 5 opens              | Verified recovery-material format and lost-all-paths behavior; no Agent Native recovery key                                                                                                                                                                                                                                                                                                                         |
| Signed desktop and agent-loop placement | PR 5 opens              | Desktop-only private-vault client; vault-scoped agent loop runs on the enrolled broker                                                                                                                                                                                                                                                                                                                              |

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

Fork evidence on 2026-07-16: preview deployment `dpl_FsbSnX2Qfr2R8Wb2thr5kvkSKFTN` served two synthetic public reads as byte-identical `200`, `Cache-Control: no-store`, `x-vercel-cache: MISS`; after the document became private, two anonymous reads were byte-identical uniform `404` responses with neither title nor body sentinel. Preview deployment `dpl_DuksDS9R6JXaXiDKDcuqHQvvcWh6` issued a 30-second document-scoped link; an immediate private-document read succeeded and a read 6.378 seconds after expiry returned the same content-free `404/no-store` shape. Private provider probes also proved anonymous direct read `403`, authenticated byte-exact retrieval, and not-found after deletion. Preview deployment `dpl_6h42L8uPgSCpcWEaMt9oh8a8UVmo` then exercised a real document-media handle: authenticated retrieval returned all 30,824 bytes with SHA-256 `1f84172faf0884ab66598e5b3ea9f48464c1a8b53c399805a88bf7529a9ec38b`; the same unauthenticated URL returned the uniform 30-byte `404`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`; deleting the synthetic document returned `{success:true,deleted:1}`, made the owner URL return the same `404`, and reduced the private Blob prefix from one object to zero. The remaining PR 1 media item is two-account share-revocation proof against a refreshed authorized read, not construction or deletion of the handle lifecycle.

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

Fork evidence on 2026-07-16: the audited `production-privacy-inventory` action required both an allowlisted authenticated operator and an out-of-band token, rejected the wrong token without counts, returned aggregate-only Content coverage, and wrote one content-free durable audit event before releasing the result. The synthetic lab reported one private document and no public/org/shared Content rows; extension and inherited-share coverage were complete, while the absent A2A queue schema was reported honestly as incomplete rather than guessed. Dynamic scoping enumerated the real Neon schema; ownable Content tables carried owner/org scope, while deployment/global framework tables were denied to raw DB tools rather than mislabeled as user-owned. Remaining closure is the feature-specific adversarial matrix, not construction of the inventory surface.

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

Current implementation: Core exports strict v1 schemas and the exact M2 budget, rejects unknown hosted fields and malformed nested metadata, and ships the fixed failure corpus. Content freezes its protected-field catalog, broker placement, deny-by-default egress, retention contract, and fail-closed beta features in `shared/private-vault-privacy-manifest.ts`. The universal resolver now covers HTTP/frontend/A2A action routes, CLI, direct MCP, run-code, generated-edge dispatch, hosted agent loops, agent teams, jobs, triggers, integrations, and nested action execution with request-scoped policy and placement-confusion rejection. The PR 3 execution-seam exit gate is closed; later milestones implement the protected execution target behind that already-centralized decision point.

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

Current fork implementation (2026-07-16):

- Fifteen additive `content_encrypted_vault_*` tables now hold only opaque
  routing records, retention/staging coordinates, and one deployment-global
  storage-generation digest. Large ciphertext is isolated in the protected
  Blob namespace; provider locators and credentials never enter SQL.
- Object revisions and encrypted jobs use the crash-safe order `stage SQL ->
write immutable Blob -> atomically commit hosted metadata plus the stage
  tombstone`. A 24-hour reconciler claims abandoned coordinates with a leased
  token; a writer can commit only while its stage remains active. Permanent
  staging and parent-retention tombstones forbid coordinate reuse, and
  object/job terminal transitions enqueue scoped deletion in the same SQL
  transaction.
- The retention worker uses immutable trigger generations and lease/generation
  compare-and-swap fences, deletes ciphertext before SQL, checkpoints that
  phase, and retains a permanent purged-coordinate tombstone. It retries
  without persisting provider errors, purges resource metadata within the
  30-day maximum, and removes access/disclosure evidence after its full 90-day
  live period on a cadence inside the seven-day purge window.
- All opaque relay/admin actions are hidden from hosted and external model tool
  catalogs. Raw DB tools, extensions, and schema prompting cannot reach any
  protected table. Named clients strictly parse suite/opaque coordinates and
  enforce declared plus actual streaming byte limits against a malicious relay.
- Protected execution inputs/results are replaced by content-free receipts in
  hosted run events, audit, analytics, application state, traces, error capture,
  ledgers, journals, caches, MCP, run-code, and generated-edge transports. Raw
  console calls are statically forbidden in protected action/broker modules.
- The Vercel protected store requires
  `AGENT_NATIVE_PROTECTED_CIPHERTEXT_STORAGE_GENERATION`; its one-way digest is
  pinned in SQL and startup refuses a later provider/generation mismatch.
  `CRON_SECRET` (or the manual-run fallback
  `CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET`) is also required. A one-way
  `CONTENT_PRIVATE_VAULT_RETENTION_CRON_SECRET_SHA256` verifier can be pinned
  when the scheduler and runtime receive deployment credentials through
  separate platform paths; a malformed verifier fails closed. The fork's
  `vercel.json` invokes `/api/private-vault/retention/run` daily at 03:00 UTC,
  while a warm process also attempts six-hour sweeps. The daily durable trigger
  is compatible with Vercel Hobby limits and remains comfortably inside the
  seven-day contractual maximum.

Focused evidence: 474 Core execution/transport/sink tests passed in the PR4
gate; the post-review private-vault regression rerun passed 115 tests across 18
files, with the earlier full Content PR4 gate passing 137 relay, client, route,
staging, retention, migration, and hosted-record tests. The Content gate includes real temporary-SQLite
tests proving that a janitor-owned stage rolls object/job metadata back and a
writer-owned stage commits metadata plus its tombstone atomically. Core build,
Content typecheck, and diff validation passed. The deployed synthetic
SQL/Blob/event/audit/log dump contains neither the protected plaintext sentinel
nor the local key, and the route/tool inventory exposes no hosted decrypt API.
The authenticated production cron invocation described above closes the final
PR4 operational gate; PR5 may now proceed.

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

Fork implementation checkpoint: the signed desktop trust anchor now owns the
rotation preparation, official custody promotion, authenticated retained-spool
read, canonical hosted-append body/proof construction, and receipt-gated cleanup
seams. Its hosted append transport is limited to a build-pinned HTTPS origin and
fixed path; it carries no browser cookies or ambient credentials, rejects
redirects, and bounds the content-free receipt before allocation. Native tests
exercise the coordinator and transport on both arm64 and x86_64. This checkpoint
also includes a native content-free retry marker, restart discovery, bounded
backoff, receipt-only cleanup recovery across process death, and aggregate
signed-main acknowledgement health. The first-device trust path now also has a
native, public-only genesis recovery-confirmation and bootstrap-transcript
verifier. It matches the frozen Core bytes and domain-separated digests, rejects
all 72 frozen malformed or misbound cases on arm64 and x86_64, snapshots caller
bytes across multi-step verification, and returns immutable decoded results.
The first-device path now continues through a concrete native genesis
authorization verifier. Its source-anchored, public-only Core corpus contains
7 signed positive boundary cases and 205 exact-category negative cases across
35 rejection categories. The native verifier binds the authorization to the
locally verified bootstrap transcript and recovery confirmation, checks the
endpoint, control-log, and authorization signatures under their exact
domain-separated messages, enforces inclusive timestamp ordering and the typed
first-device commit invariants, and returns only immutable public results. The
hardened ControlLog callback supplies immutable typed snapshots plus the exact
signed bytes and fails closed on exceptions, caught mutation attempts, or caller
buffer changes. Both the verifier and callback passed arm64 and x86_64 corpus
tests, the 9-test production native-service suite, deterministic corpus
regeneration, and an independent trust-boundary review with a GO verdict. The
verifier is compiled into the universal production XPC service.

The fork now also has a crash-safe native genesis commit coordinator. It
pre-authenticates the exact public recovery confirmation, bootstrap transcript,
authorization, signed control-log genesis, and pending g1 custody tuple before
durably staging anything. A restart validates a bounded artifact inventory,
re-verifies every signature and binding, reconciles every Keychain
fail-before/commit-then-error boundary, promotes custody to exact anchored g2,
rereads the official authority tuple, and removes the public artifacts only
after proof. The artifact store pins and revalidates the complete
`root -> state -> genesis` directory chain, fsyncs both parent directory links
even after `EEXIST`, rejects swaps, symlinks, hard links, unknown files, corrupt
frames, and unbounded temporary-file accumulation, and proves an empty startup
fixed point before the XPC service accepts any operation. The narrow
`commit_genesis` request accepts only the three bounded public artifacts; it
does not accept a vault id, path, key, timestamp, URL, or secret. Native tests
cover 32 concurrent same-vault commits, unavailable clock, restart, directory
faults, and every observed custody mutation boundary. The final-source arm64
suite, production service build, protocol runner, desktop client tests, and
typecheck pass; the final-source x86_64 coordinator rerun remains pending after
a Rosetta loader process wedged before test execution. Earlier dual-architecture
corpus passes remain supporting history, not a substitute for that rerun.

The trust anchor now also generates guarded 32-byte recovery entropy, encodes
and validates its exact checksum-bearing 24-word English BIP39 form, and derives
the generation-separated recovery authority from the frozen Argon2id root. The
decoder uses bounded byte-level UTF-8 parsing, an explicit Unicode-whitespace
set, ASCII-only BIP39 words, constant-time entropy confirmation, fixed-capacity
caller snapshots, and explicit secret-buffer cleanup; it leaves no immutable
Foundation copies of the phrase. The full vendored 2,048-word order is checked
at runtime against pinned `@scure/bip39@2.2.0`, and the production service
contains the primitive without adding an XPC, addon, preload, or hosted-webview
operation. Current-source arm64 production and recovery-test builds, the native
negative runner, Core parity, typecheck, and independent security review pass.
Current-source x86_64 execution remains pending because both the coordinator
runner and a libsodium configure probe wedged in Rosetta before entering their
tests; no translated result is being inferred from the arm64 pass.

The durable preparation store now has proof-specific production transitions
for the first-device path. Confirmation re-snapshots and freshly authenticates
all five public artifact properties, replays the signed genesis entry, enforces
one exact confirmed second across the frozen signed timestamp tuple, stages and
promotes the digest-bound artifact frame, and constructs the CONFIRMED record
internally. COMMITTING is reachable only from live CONFIRMED artifacts, and the
custody-binding step independently rereads the exact pending-genesis g1 before
persisting its full wire-record fence digest. Exact retries are no-ops; wrong
tokens, timestamp truncation, identity substitution, mutable caller artifacts,
and custody substitution fail closed. The arm64 production build, focused
preparation storage suite, and custody repository suite pass. This is a
store-level checkpoint, not yet a user-visible first-device ceremony.

The native coordinator now also exercises a complete synthetic first-device
ceremony. It generates a guarded recovery mnemonic and bearer handle, persists
PREPARED without custody or authority, rejects a wrong full-entropy
confirmation without side effects, and advances the correct confirmation
through authenticated artifacts, pending g1, official encrypted g2, exact
official reread, and preparation-secret erasure. A second confirmation is an
exact no-op backed by the same official state. Current-source arm64 production,
coordinator, preparation-storage, and custody-repository suites pass. The
ceremony remains native-internal; the trusted desktop UI is still an open gate.

The native lifecycle now also closes cancellation and expiry without inventing
authority. User-authorized cancellation works from PREPARED, CONFIRMED, and
COMMITTING; it first proves that both hardened authority paths are absent. If a
pending g1 custody record exists—even across an interrupted bind—it is bound,
replaced by a secret-free cancelled-genesis g2 tombstone, and linked to its
exact predecessor wire digest. The preparation record then terminalizes all
five secrets, replaces its g1 custody digest with the tombstone digest, deletes
the exact bound public spool or a fully ceremony-bound unbound stage, deletes
the coordinator's separate vault-bound genesis spool, and retires its
preparation marker. The predecessor g1 digest—not a caller's retry clock—is the
cancellation identity, so a retry preserves the tombstone's original terminal
time after a crash. PREPARED expiry is permitted only strictly after its durable deadline
and only while authority and custody remain absent. Both operations are
restart-idempotent. Codec, custody repository, authority, preparation storage,
and complete coordinator tests cover substitution, generic tombstone writes,
all custody fence failures and ambiguous writes, concurrent cancellation,
deadline boundaries, orphan-stage cleanup, cancellation before confirmation,
and cancellation after pending custody but before official authority. Arm64-only runners are now
explicit for the affected custody and authority suites.

Native startup is now preparation-aware and remains a hard request-surface
gate. A preparation's external 48-byte bearer is derived from its protected
local-state key plus the public lookup, vault, and ceremony identifiers; the
bearer itself is never persisted or exposed, while the native service can
reconstruct it inside guarded startup scope. PREPARED records never become
confirmed during startup: they remain pending until their deadline and then
expire. Durably CONFIRMED or COMMITTING records resume the existing exact
confirmation path through artifact reconciliation, pending custody, official
authority, and secret terminalization. The production XPC service now
constructs the generation fence and both preparation stores and performs two
preparation passes around the legacy official-artifact sweep before setting its
startup-complete gate. The gate observes trusted time even when both work lists
are empty, removes marker-only crash remnants, completes exact digest-bound
CANCELLED/EXPIRED artifact cleanup, and rejects any residual terminal marker.
A COMMITTED record with live artifacts therefore keeps startup closed until its
independently verified hosted receipt has authorized cleanup.

Time-dependent mutations now use a device-wide persisted trusted-time floor.
Separate current and high-water Keychain frames carry versioned,
domain-separated integrity checks and advance pending-to-stable. Interrupted
initialization and updates recover only toward the larger authenticated floor;
a lower system clock, a missing half, corruption, or an inaccessible frame
fails closed without changing preparation, custody, authority, or artifacts.
Synthetic coverage exercises every initialization and update write boundary,
restart recovery, backward time, corruption, pending PREPARED startup, expiry,
CONFIRMED/COMMITTING continuation without a caller bearer, marker-only repair,
and interrupted cancellation cleanup. These two Keychain frames detect wall
clock rollback, corruption, partial loss, and interrupted writes inside their
local rollback domain. They cannot detect a coordinated restore of both frames
to the same older valid snapshot; that stronger claim requires the planned
remote or hardware monotonic witness and remains a release gate.

This still does not close PR 5: complete enrollment and recovery product flows,
malicious-directory and stolen-session transcripts, and the independently
packageable broker exit gate remain.

Committed local cleanup now has its own protocol-confusion-resistant
`control-log-genesis-append-*` canonical request and receipt rather than
borrowing rotation's sequence-positive type. The exact sequence-zero receipt
is reread from a dedicated nonsynchronizable Keychain service, hashed under the
frozen `anc/v1/genesis-hosted-append-receipt` domain, and bound to COMMITTED
before the digest-bound artifact can be deleted. Startup recovers the three
crash windows—after receipt persistence, receipt binding, and artifact
deletion—and retires the marker only after a CLEANED reread. The Core and native
digest vector is `8b12f022…d547`. This is a receipt verifier and cleanup fence,
not permission to synthesize a local receipt: only a hosted service that has
independently committed the admitted genesis entry and exact recovery-wrap blob
may issue it.

Account admission now uses a separate session-authenticated challenge ceremony.
The server derives a stable Better Auth subject and requires a current
organization-membership row, then issues a five-minute challenge bound to the
exact public genesis candidate, account, and workspace. The enrolled endpoint
signs the final canonical request with the existing endpoint-request proof;
public ceremony artifacts alone cannot claim a vault. Challenge consumption,
the immutable admission anchor, and the vault row commit atomically, while an
exact lost-response retry returns the same scoped receipt. The server retains
only content-free challenge coordinates and hashes and purges them after
expiry. `CONTENT_PRIVATE_VAULT_GENESIS_CHALLENGE_SECRET` must contain 32 random
bytes encoded as lowercase hex; rotation invalidates only live challenges and
never changes admitted vault identity.

The matching native account-admission codec now reproduces the frozen Core
candidate, challenge, request, receipt, and candidate-hash bytes with the same
field counts and allocation caps. The coordinator independently reconstructs
the public candidate from a COMMITTED local ceremony, validates the bounded
challenge under persisted trusted time, signs only the fixed admission path,
reconstructs the candidate again while holding the per-vault lifecycle lock,
and accepts a receipt only when account, workspace, vault, control entry,
endpoint, candidate, and bootstrap transcript all match the official local
tuple. Acceptance returns the already-frozen sequence-zero append request; it
does not clean local evidence. A complete native ceremony test proves exact
authorization and acceptance and rejects challenge and receipt substitution.
The focused account-admission, preparation-store, coordinator, and endpoint
request suites pass on arm64; the endpoint request suite also passes on
x86_64.

Desktop main-process orchestration now has a public-bytes-only transport seam.
Its fixed sequence is native candidate reconstruction, session-authenticated
challenge, native proof authorization, session-authenticated admission,
native receipt acceptance, cookie-free sequence-zero append, and native hosted
receipt finalization. The transport pins one exact HTTPS origin, rejects
redirects, enforces exact media types and content lengths, omits credentials
from append, collapses errors, and resumes only native-reported COMMITTED
ceremonies. Recovery words, entropy, signing seeds, and endpoint private keys
are absent from the TypeScript interface. Seven focused orchestration and
transport tests plus the desktop typecheck pass.

The signed XPC/addon and trusted confirmation gate are now connected. Protocol
v3 exposes seven exact, bounded genesis operations to the signed addon; the
preparation response carrying the recovery phrase is accepted only over the
code-signature-pinned XPC connection. A native AppKit ceremony displays the
24-word phrase, requires an explicit saved acknowledgement and complete
re-entry, and passes the typed bytes directly back to XPC without returning the
phrase to JavaScript. Admission separately displays the server-validated
account and workspace and requires a native Connect Vault confirmation before
the endpoint signs. The addon returns only public lookup, candidate, proof,
receipt, vault, account, and workspace artifacts and clears its bounded secret
buffers.

Content's desktop webview now has only two no-argument IPC methods: create and
resume. The main process rejects every renderer-supplied argument, reuses the
existing active-Content-webview origin check, requires the configured Content
origin to be HTTPS, binds transport to that Electron session, and collapses all
denial and ceremony failures. The webview cannot provide recovery text,
candidate bytes, account coordinates, paths, endpoints, or arbitrary native
operations. Twenty-two focused bridge, orchestration, transport, and addon
tests, protocol tests, the complete arm64 coordinator ceremony, the production
arm64 service build, universal addon load, and desktop typecheck pass. This
closes the trusted confirmation UI/XPC reachability checkpoint; it does not yet
make a recoverable product vault because recovery import and the remaining
broker flows are still absent.

The hosted broker relay is no longer a PR4 fail-closed stub. Core now freezes
canonical, bounded request/response frames for the five exact broker-job paths.
Content authenticates every cookie-free request against a fresh, replayed
signed control head, requires the signer to be the single active unattended
broker, and claims the proof nonce only after the body, path, method, identity,
and authority all verify. Caller headers and message bodies never declare the
principal. The fixed routes claim content-free coordinates, return only the
exact encrypted leased request, fence acknowledgement and retry by attempt,
and accept only a bounded encrypted result for the authenticated vault.

The reusable broker package now implements the matching one-job local loop:
claim, fetch, native authenticated open, acknowledge, injected local action
execution, native result sealing, and encrypted submission. It cross-checks
the claim against the returned ciphertext frame, binds the native-authenticated
job hash into the result, zeroizes every transferred plaintext/result buffer,
serializes work, and moves failures to bounded encrypted retry instead of a
hosted fallback. Core vectors, route/auth unit tests, a real temporary-SQLite
signed-control-head authentication and replay-denial test, all 48 broker tests,
Core and broker typechecks, Content typecheck, and Core build pass. The worker
still needs a packaged process, concrete encrypted state/index, app action
executor, enrollment/recovery, and lifecycle supervision before the broker exit
gate closes.

Recovery and later enrollment now have a hosted bootstrap read boundary. A
same-origin, session-authenticated client asks for the beta account's one vault
without supplying a vault identifier; the server resolves stable account and
workspace coordinates from current membership, fully replays the signed
control log, and returns bounded contiguous pages pinned to one exact head.
Each page carries the exact encrypted recovery wrap for every control edge on
that page that activated one, while the final page separately carries the
current wrap; immutable entry-to-wrap bindings prevent the hosted projection
from quietly skipping an epoch transition. A concurrent append, stale pin, log
gap, binding mismatch, noncanonical request, wrong media type, or cross-site
request fails closed. The response contains public control entries and
ciphertext only—never recovery entropy, endpoint secrets, or a server recovery
key. The desktop transport streams pages into an injected signed-native replay
consumer under one pinned head rather than aggregating them in the renderer.
The server also stores the exact canonical genesis admission candidate in
immutable private blob storage under its candidate commitment and binds it to
the admitted control entry without putting evidence bytes or provider locators
in SQL. Bootstrap frames carry per-entry typed evidence alongside wraps, with a
strict 8-entry and approximately 25 MiB worst-case frame bound. Core protocol
vectors, route/service tests, a real SQLite genesis ceremony and canonical-log
snapshot tests, and desktop transport tests pass. Recovery now has a distinct,
bounded append envelope carrying the exact current snapshot and recovery
authorization. The server verifies every publicly checkable recovery signature
and binding, authenticates the replacement endpoint over the exact request,
stages the replacement wrap and canonical evidence independently, and commits
both bindings, the signed edge, the replacement endpoint, old-endpoint
revocation, and a durable confirmation-nonce fence in one SQL transaction.
Historical replay reloads those immutable artifacts and the exact nonce claim;
it evaluates time at the signed edge rather than incorrectly expiring valid
history. Only native code may assert that the mnemonic unsealed the consumed
wrap. Full independent native authorization replay, mnemonic import,
replacement recovery authority, and recovered-endpoint admission through XPC
remain the next product gate.

The bootstrap envelope now also crosses the signed desktop boundary without
being decoded or accumulated in the webview. Protocol v3 accepts one exact
bounded `accept_bootstrap` frame, the addon copies and clears the caller-owned
bytes, and the XPC service applies a strict native decoder with aligned entry,
wrap, and control-evidence slices, page-contiguity checks, completion rules,
and no trailing-byte tolerance. The typed main-process result is deliberately
named `parseBootstrapFrame` and reports `parsed`, not `accepted`: this closes
native transport and grammar reachability only. Dual-architecture native frame
tests, protocol tests, the universal addon build, desktop client tests, and the
desktop typecheck pass. Cryptographic control-log replay and recovery-authority
verification remain required before this surface may consume a bootstrap page
as trusted vault state.

Native PREPARE is now contract-bound to generate 32 bytes of recovery entropy,
display and fully confirm its checksum-valid 24-word BIP39 encoding, feed the
decoded bytes rather than mnemonic text to Argon2id, and use the exact
native-generated 16-byte vault ID as the salt for genesis and every later
recovery generation. This preserves the frozen `anc/v1` wire format while
removing an otherwise fatal recovery interoperability ambiguity. Core/native
derivation parity is now closed on arm64 and independently reviewed; the
current-source x86_64 rerun and actual recovery-wrap persistence remain
implementation gates before the first real vault is created.

The public lifecycle `AncV1RecoveryEnvelope` codec retains an arbitrary salt
only to decode its frozen synthetic compatibility vector. It is a parallel
sealed-EEK envelope, not the authoritative recovery-wrap path, and is forbidden
for native PREPARE and new vault creation. Product code uses the canonical
entropy-plus-vault-ID helper and the signed recovery wrap exclusively.

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

| Property                      | Unit/vector                             | Integration/adversarial                       | Deployed evidence                       |
| ----------------------------- | --------------------------------------- | --------------------------------------------- | --------------------------------------- |
| Server blindness              | Known-plaintext and key-search fixtures | SQL/blob/log/audit/job dump                   | Real preview/prod storage inspection    |
| Device and recipient identity | Signature/envelope vectors              | Malicious directory and wrong-recipient tests | Enrolled-device ceremony                |
| Agent grants                  | Scope/provider/expiry/revocation tests  | Scope expansion and stale-grant attempts      | User-visible grant and disclosure audit |
| Offline failure               | Queue state machine tests               | Broker killed mid-operation                   | Missed/queued run in built client       |
| Rotation and removal          | Epoch/replay vectors                    | Removed offline device and stale write        | Two-device canary                       |
| Private indexes               | No-plaintext-cache assertion            | Search/database corpus coverage               | Cold rebuild and incremental benchmark  |
| Egress                        | Disclosure-schema tests                 | Model/integration/public boundary tests       | First-disclosure and revoke UI proof    |
| Migration/recovery            | Idempotency and corruption vectors      | Interrupted cutover/export/recovery           | Synthetic vault drill                   |
| Client integrity              | Artifact/signature tests                | Malicious update/channel simulation           | Built signed-client verification        |
| Revocation                    | ACL/key-epoch tests                     | Public-to-private and media leak tests        | Real CDN/provider fetch after revoke    |

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
