# Content Private Vault Beta Runbook

Parent plan: [Content E2EE Implementation Wayfinder](./content-e2ee-implementation-wayfinder.md)

Trust contract: [Content Encryption Trust Contracts](./content-encryption-trust-contracts.md)

Cryptographic design: [Content E2EE M3 Cryptographic Design](./content-e2ee-m3-cryptographic-design.md)

## Purpose

This runbook is the release gate for the first exact-account Private Vault beta.
It uses only synthetic accounts and synthetic content until every row below has
current evidence. It does not authorize migration of `teenylilthoughts` or any
other real vault.

Private Vault remains disabled by default. A successful repository test, a
healthy Vercel deployment, or a signed Desktop build is necessary but is never
individually sufficient to make an E2EE claim.

## Roles and separation

Record one named person for each role. One person may prepare evidence but may
not approve their own cryptographic or claim-to-evidence review.

| Role               | Authority                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Release operator   | Deploy the fork, target exact synthetic accounts, and retain content-free evidence       |
| Security reviewer  | Review protocol, implementation, negative cases, and claim mapping independently         |
| Canary operator    | Perform the attended Desktop ceremonies on synthetic accounts and devices                |
| Incident commander | Invoke lock/revocation/rollback stop conditions and decide whether the canary may resume |

## Required environment

- One immutable fork commit on `codex/content-e2ee-foundation`, pushed to
  `3mdistal/agent-native`.
- One fork-owned Vercel preview and one fork-owned Neon database. Never point the
  canary at production customer storage.
- One macOS Desktop artifact built from that exact commit. Record its release
  URL, SHA-256, notarization result, signing team, and designated requirement.
- Two synthetic accounts in separate tenant scopes and two clean macOS user
  profiles. A second physical Mac is required for the cross-device enrollment
  and recovery rows.
- Independent generated auth, A2A, scoped-secret, and provider credentials for
  this environment. Record identifiers and key versions, never secret values.
- Exact-account values for these default-off flags:
  `content-private-vault-access`, `content-private-vault-enrollment`, and
  `content-private-vault-migration`.

## Evidence packet

Create one append-only packet for the run. Every row records:

- UTC start and finish timestamps;
- fork commit, deployment ID, database branch ID, Desktop version, and artifact
  SHA-256;
- synthetic account and device aliases, never session cookies or credentials;
- action or ceremony name, expected result, actual result, and content-free
  receipt or log reference;
- negative-control result from the other account or a disabled flag;
- reviewer, decision, and any exception with an owner and expiry.

Screenshots must not contain recovery words, document plaintext, bearer tokens,
cookies, provider credentials, raw ciphertext, or customer data. Prefer hashes,
opaque IDs, counts, states, headers, and signed receipt coordinates.

## Automated entry gate

All checks must run against the exact candidate commit:

1. `Content E2EE assurance / Portable contracts and adversarial paths` passes.
2. `Content E2EE assurance / Universal native trust anchor` passes, including
   native request framing, export archive, hostile native corpus, universal
   architecture checks, and packaging-contract tests.
3. Core, broker, Desktop, and Content typechecks pass.
4. The macOS release job verifies the signed packaged app before its draft
   release can become public.
5. The fork worktree contains no uncommitted E2EE source or schema change.

Any skipped, neutral, stale, or different-commit check is a failure, not a
creative interpretation of green.

## Preview canary

### 1. Default-off and tenant isolation

1. Confirm all three flags are off for both synthetic accounts.
2. Verify Private Vault enrollment, migration, opaque object access, and broker
   routes fail with the same content-free unavailable shape as nonexistent
   resources.
3. Enable access and enrollment for account A only. Account B must remain
   unable to discover A's vault, object, job, grant, migration, enrollment, or
   disclosure coordinates.
4. Run the scoped database check against the final migrated schema and retain
   only its sanitized summary.

### 2. Genesis, custody, and recovery

1. Create A's vault through signed native UI and write the recovery words to an
   offline canary record. Words must never appear in renderer state, logs,
   process arguments, environment variables, network traffic, SQL, or evidence.
2. Lock and reopen the vault on the first endpoint.
3. Enroll the second endpoint through the full native comparison ceremony.
4. Recover on a clean macOS profile using only the recovery words and hosted
   public control history.
5. Attempt the same operations as B, with an unapproved endpoint, with a stale
   control head, and with replayed ceremony material. Each must fail closed.

### 3. Ciphertext storage and local agent loop

1. Generate a unique synthetic title and body locally. Record only their
   SHA-256 values in evidence.
2. Create, read, edit, search, version, restore, nest, move, and delete private
   documents through signed Desktop.
3. Inspect fork Neon, fork blob storage, deployment logs, action audit rows, and
   captured HTTP bodies for the exact synthetic bytes. Record zero matches and
   the scanned store/log ranges without exporting unrelated rows.
4. Ask a local agent to list and read the document through the familiar Content
   action names. Verify the hosted plane observes only opaque job coordinates
   and ciphertext.
5. Put the broker offline, queue work, and verify it waits encrypted without a
   plaintext fallback. Reconnect and verify exactly one bounded result.
6. Approve one model destination, run one read, and verify the signed Desktop
   “Who can read?” activity names the exact provider, model destination, action,
   outcome, and expiry. A changed destination must require a new disclosure.

### 4. Revocation and incident drill

1. Revoke the agent grant while one job is queued. Future work and the queued
   unauthorized disclosure must fail closed.
2. Revoke the second endpoint and verify it cannot fetch new epochs or decrypt
   newly written revisions.
3. Exercise control-log rotation and recovery rotation. Replayed old wraps,
   stale heads, split-brain membership, and wrong-account bootstrap pages must
   fail.
4. Invoke the operational kill for A. It must lock decryption and disclosure;
   it must never route to Standard Cloud.
5. Restore service only after the incident commander reviews the content-free
   evidence and records an explicit resume decision.

### 5. Standard Cloud migration drill

Use a fresh synthetic Standard Cloud hierarchy containing only the explicitly
supported document fields.

1. Enable migration for A only. Freeze the source set and start migration.
2. Interrupt once during copy, once before manifest cutover, and once after
   plaintext deletion but before the cleanup-ledger receipt. Each retry must
   converge without duplicate visible documents or partial deletion.
3. Alter one source after preflight. Migration or cleanup must stop on the source
   digest mismatch.
4. Roll back a separate pre-cleanup migration and verify its encrypted staging
   objects are removed while Standard Cloud stays readable.
5. Complete a clean migration. Verify every encrypted revision and the cutover
   manifest before local visibility changes.
6. Save the non-overwriting mode-0600 recovery archive. Close and reopen Desktop
   and confirm the durable ceremony resumes at the export-attested state.
7. Select that exact archive and enter all recovery words in signed native UI.
   Confirm the recovery drill records only signed commitments and advances to
   `cleanup_eligible`.
8. Cancel the first cleanup confirmation; originals must remain. Confirm the
   second attempt, after Desktop re-opens every encrypted object. Verify only the
   unchanged scoped originals are deleted.
9. Record the database/blob provider's documented backup and deletion horizons.
   The product disclosure must describe retained ciphertext and metadata; do not
   imply immediate physical erasure.

## Signed artifact gate

For the candidate macOS artifact, retain the output of
`verify-private-vault-signed-app.sh`. It must prove:

- the app, XPC bundle, XPC executable, and native addon occupy exact real paths
  and are not symlinks;
- strict nested code-signature verification succeeds;
- the app and XPC service have the expected identifiers and Builder signing
  team;
- the executable and addon carry the same signing team;
- the signed XPC entitlements contain network-client authority and only the
  expected Private Vault keychain access group;
- both native artifacts contain arm64 and x86_64 slices; and
- SHA-256 values are retained for the exact XPC executable and addon.

Notarization and Gatekeeper assessment must also pass on a clean Mac before the
artifact is offered to a canary user.

## Claim-to-evidence review

The beta may say:

> Private Vault pages are end-to-end encrypted. Agent Native's hosted Content
> service stores ciphertext and cannot read page contents. Enrolled endpoints,
> agents you authorize, and model providers you choose can read only the content
> involved in their approved work.

It must also disclose that ciphertext lengths, timing, network logs, and opaque
access patterns remain visible; endpoints and approved providers are trusted
readers; device compromise defeats that device's protection; and unsupported
workflows stay unavailable.

The beta must not say “zero knowledge,” “audited E2EE,” traffic-analysis
resistant, post-quantum, impossible to lose, or fully Notion-compatible.

The independent security reviewer maps every sentence to current automated,
deployed, and artifact evidence. Missing or disputed evidence blocks the claim.

## Stop conditions and rollback

Stop immediately and disable new enrollment/migration for the exact canary
accounts if any of these occur:

- protected plaintext appears in hosted SQL, blobs, logs, audit inputs, crash
  reports, browser state, or network captures;
- an unrelated account learns whether a protected coordinate exists;
- a server, browser renderer, or ambient hosted agent obtains vault keys or
  recovery words;
- a stale/revoked endpoint, grant, epoch, or disclosure succeeds;
- offline work falls back to Standard Cloud or another plaintext path;
- migration deletes an unverified, changed, partial, or out-of-scope source;
- the signed artifact, update chain, or embedded native identity differs from
  the reviewed candidate; or
- a required evidence source is missing or cannot be tied to the exact commit.

Rollback locks Private Vault and leaves ciphertext intact. It never exports
plaintext to hosted storage, silently reenables Standard Cloud, rewinds the
control log, or invents a recovery path. Preserve the failed evidence packet,
rotate affected credentials or epochs, and require a fresh review before retry.

## Promotion sequence

1. Fork preview with account A only.
2. Fork preview with A and the separate-tenant negative-control account B.
3. Production infrastructure with exact synthetic accounts only.
4. Signed beta artifact to named internal canary users.
5. Exact real-user beta only after independent cryptographic and implementation
   review findings are closed or explicitly accepted with bounded expiry.

Percentage rollout, automatic migration, customer-vault migration, and broad
template-wide E2EE remain out of scope.
