# Content E2EE M3 Cryptographic Design

Status: conditionally approved for implementation after the frozen-vector and ceremony-review checks below
Suite: `anc/v1`
Evidence date: 2026-07-16
Independent reviewer: Claude Fable 5 via OpenRouter; complete review retained as a separate local experiment artifact during design synthesis
M1/M2 contract: [Content E2EE M1/M2 Executable Contract](./content-e2ee-m1-m2-executable-contract.md)

## Review decision and corrections

The independent review returned a conditional **GO** and identified two trust-language corrections, both adopted here:

1. External-model disclosure is broker-to-provider directly over TLS. The hosted Agent Native plane sees the signed disclosure envelope and opaque job state, but never handles provider plaintext. A future hosted proxy would be a separately labeled, weaker “relay-transited disclosure” mode and cannot inherit the E2EE claim.
2. “Unattended” means “while your enrolled broker is reachable.” Sleeping laptops are famously committed to their craft. When the broker is offline, encrypted jobs queue with expiry; no hosted decryption fallback exists.

Runtime cryptography may begin only after the fixed interoperability vectors and ceremony transcript review are committed. No primitive negotiation or silent downgrade is permitted.

## Threat model

Protected assets are document plaintext and names/structure; vault epoch and per-object keys; endpoint private keys and recovery material; integrity of content, endpoint membership, epochs, grants, disclosures, jobs/results, and their history; and agent transcript/tool-loop state.

The plaintext-bearing trusted computing base is the enrolled endpoint set, including the personal broker; the signed Electron distribution/update chain; the endpoint OS keystore; and any external model provider explicitly approved for a bounded disclosure. A compromised broker can read everything it decrypts. E2EE moves trust from hosted servers to enrolled user devices—it does not make a compromised device magical.

The design must withstand complete database/blob/backup/log disclosure, a malicious hosted operator, a stolen web session, replay/rollback/fork attempts, and removed endpoints. The hosted service may withhold or reorder data and cause availability loss, but cannot decrypt, enroll an endpoint, mint/extend authority, or silently rewind control history without endpoint detection.

Beta does not hide sizes, coarse timing, account/endpoint counts, access patterns, or network metadata. It does not protect plaintext already disclosed to an approved external provider, resist a compromised enrolled endpoint, guarantee availability, or provide multi-user collaboration.

## Frozen suite

`anc/v1` is one suite pin, not an algorithm menu. Unknown suite identifiers fail closed. Migration to a future suite is a signed epoch-level ceremony with fixed dual-version vectors; it is never per-message negotiation.

| Purpose                                      | Primitive                                            |
| -------------------------------------------- | ---------------------------------------------------- |
| Object and DEK-wrap AEAD                     | XChaCha20-Poly1305-IETF                              |
| Large-object streaming                       | libsodium `crypto_secretstream_xchacha20poly1305`    |
| Endpoint/log/grant/disclosure/job signatures | Ed25519                                              |
| Endpoint key agreement / sealed payloads     | X25519 through libsodium `crypto_box` / sealed boxes |
| Hash chain, scope hashes, SAS transcript     | BLAKE2b-256 with domain separation                   |
| Recovery hardening                           | Argon2id over a full-entropy recovery secret         |
| Canonical signing bytes                      | RFC 8949 deterministic CBOR with integer keys        |

Every signature/hash input begins with UTF-8 `anc/v1/<type>`, one zero byte, then deterministic CBOR. Domain tags and integer field tables are frozen in `@agent-native/core/e2ee`. Unknown CBOR keys are rejected in v1.

## Key hierarchy and rotation

- Each endpoint generates Ed25519 signing and X25519 key-agreement keypairs. Private halves never leave the endpoint and are wrapped with Electron `safeStorage`/the OS keychain.
- Each epoch has a fresh random 32-byte epoch key, independent of prior epochs.
- Each object revision has a fresh random 32-byte DEK. DEKs are not deterministically derived; this preserves per-object crypto-shredding and cheap rewrap.
- The DEK encrypts exactly one object revision and is wrapped under the active epoch key with associated data binding vault, object, revision, and epoch.
- The epoch key is boxed to every authorized endpoint and the recovery public key. Each wrap is signed by the issuing endpoint and binds recipient, issuer, vault, and epoch.

Removing an endpoint creates a new independent epoch key, rewraps every live DEK to the remaining endpoint set, obtains signed acknowledgements, and destroys the old epoch key on remaining endpoints. Until rotation completes, removal is an explicit alerting state—not success theater.

### Native custody memory boundary

The native 1,088-byte custody record contains five secret values: the endpoint
signing seed, agreement seed, local-state key, active epoch key, and pending
epoch key. Outside the `CFData` returned synchronously by Security.framework,
the complete record exists only in locked, no-access-by-default guarded memory.
Repository code imports the Keychain bytes during that callback, exposes guarded
bytes only to synchronous borrows, streams checksum and fence hashing without a
concatenated stack preimage, and explicitly closes each buffer so protection or
zeroization failures propagate. Public custody and authority APIs expose only
the public snapshot plus the existing guarded five-secret handle; they never
return the serialized record as `NSData`.

### Crash-safe rotation preparation namespace

Ordinary epoch rotation uses a separate, fixed 512-byte local
`rotation-preparation` record and generation fence. It never writes intermediate
states into the official custody repository: official custody remains `ACTIVE`
at epoch N throughout preparation. Because this 512-byte record contains the
pending epoch key, it is persisted only in OS-protected Keychain/secure storage,
never as an ordinary disk file. The preparation record has endpoint and broker roles and six monotonic
phases: `PREPARED`, `REWRAPPED`, `ACKNOWLEDGED`,
`AWAITING_CONTROL_COMMIT`, `CONSUMED`, and `CLEANED`. Reuse is only a fenced
`CLEANED` → `PREPARED` CAS at the next preparation generation with a new
ceremony, base authority, and pending key. The record itself is never deleted.

The signed control-log entry and recovery-wrap artifact form one exact inner
`ANVROT01` frame. That plaintext exists only in memory. Disk persists an
`ANVROTE1` XChaCha20-Poly1305 outer frame encrypted with a spool key derived
from the pending epoch key (and, after promotion, the identical official active
epoch key), vault, and ceremony. The authenticated header binds lengths, vault,
ceremony, nonce, and inner-frame digest. A domain-separated digest of the whole
encrypted frame is frozen in the preparation record; no plaintext artifact or
pending key appears in the JSON vector corpus.

`AWAITING_CONTROL_COMMIT` retains the pending key and exact encrypted-spool
binding. Completion order is fixed: stage the next authority entry; CAS official
custody so old N is destroyed and N+1 becomes active; promote authority; reread
the exact official custody/authority tuple; only then CAS preparation to
`CONSUMED`. The duplicate pending-key slot is zero in `CONSUMED`, but public
bindings and the encrypted spool remain.
`CONSUMED` means local crypto commit complete while hosted append/ack is still
pending; a crash retries from the spool using official active N+1. Signed-log
success is not reported before durable hosted acknowledgement. The client
strictly decodes the canonical content-free receipt, authenticates its vault,
entry ID, sequence, head, recovery-wrap hash, and exact wrap length against the
retained spool and official authority, then durably stores that exact receipt in
OS-protected Keychain before deletion. Only after that receipt fence may the
client delete the spool and fsync its containing directory, then CAS to
`CLEANED`, clearing pending epoch/key, edge, length, and digest fields. A
missing spool without the exact retained receipt is rollback, never a cleanup
retry; `CLEANED` idempotence also requires the same receipt bytes.

The fork's native client implements the `CONSUMED` hosted-append boundary as a
narrow background operation. It rereads the authenticated official
custody/authority tuple, decrypts the retained spool only during a synchronous
custody borrow, verifies the committed signer and recovery-wrap bindings, and
constructs the canonical append body and endpoint proof inside the native
service. The XPC caller can request rotation resumption, but cannot supply a URL,
path, method, body, proof, signing key, or receipt. The transport uses a
build-pinned exact HTTPS origin plus the fixed append path, an ephemeral session
with no cookies, credential store, redirects, or cache, and accepts only an exact
200 response with the canonical media type and a declared 1–1024-byte body.
Transport or receipt failure leaves the state at `CONSUMED` with the encrypted
spool intact. After authenticated resumption and before any hosted network
attempt, the native service durably writes a content-free, vault-bound retry
marker under the pinned state root. Startup and signed-main health wakeups scan
the bounded union of those markers and structurally valid encrypted live-spool
identities, then re-enter the coordinator for official tuple and spool
authentication. Duplicate work is coalesced and retried with bounded exponential
backoff while constructing a fresh proof for every POST. The exact receipt is
fenced in Keychain before spool deletion. If a
crash lands between deletion and the final state CAS, a fresh native process can
read that receipt internally and finish `CLEANED` without returning it to the
caller. The retry marker is removed only after an official `CLEANED` reread.
Signed-main health exposes only the aggregate acknowledgement state
`unavailable`, `idle`, `pending`, `retrying`, or `attention`; it exposes no vault
identifier, count, URL, HTTP detail, proof, receipt, or content.

Hosted acknowledgement is bound to the exact historical control edge, not to
the accident of that edge still being the latest head. The server replays and
authenticates the complete latest log, the edge's canonical stored bytes, its
predecessor-authorized signer, immutable recovery-wrap binding, and exact Blob
bytes before returning the same canonical receipt. This lets a lost response
recover after a later valid edge or signer removal without weakening rollback
or fork detection.

## Object and stream format

Object headers bind suite, vault/object ID, monotonic revision, epoch, chunk count, plaintext length, content-type tag, DEK-wrap reference, writer endpoint, and signature. Titles and filenames live only inside ciphertext.

Single-frame content uses XChaCha20-Poly1305 with a random 24-byte nonce. Large content uses `secretstream` in fixed 1 MiB plaintext chunks, with per-frame associated data binding object, revision, chunk index, and count. The final frame must carry `TAG_FINAL`; truncation, reordering, splicing, wrong recipient/object/revision, any bit flip, or missing final tag fails with one opaque local `VaultCryptoError` and zero released plaintext.

Caps: 64 KiB control/log envelopes, 16 KiB object headers, 1 MiB chunks,
256 MiB objects, and 16 MiB encrypted job/result payloads. Signed canonical
job and result envelopes receive a separate 64 KiB framing budget so a valid
maximum payload is not rejected merely because its authenticated fields and
signature also occupy bytes.

## Control log, rollback, and deletion

Endpoint membership, epochs, grants/revocations, disclosures, recovery, object tombstones, and rotation acknowledgements form an endpoint-signed append-only hash chain. Each entry binds sequence, previous BLAKE2b-256 hash, signer, and canonical inner envelope.

Every endpoint persists the highest verified `(sequence, head hash)`. A lower sequence or conflicting hash at the same sequence is a hard rollback/fork failure. Before unattended work, the broker must refresh and verify a head no older than 15 minutes; a withholding server can stop work but cannot silently preserve stale authority.

Objects carry monotonic signed revisions and endpoints persist per-object high-water marks. The v1 format reserves signed vault-manifest snapshots mapping object IDs to current revisions so newly enrolled devices can detect object rollback. These snapshots are required before beta release.

Deletion writes a signed tombstone, destroys live DEK wraps, asks hosted storage to delete ciphertext, and becomes cryptographically unrecoverable after the next epoch rotation destroys the old wrapping key. Product copy must not promise instant backup erasure.

## Grants, jobs, and disclosure

Possessing a grant never conveys key material. Internal agent grants are endpoint-signed and bind subject endpoint/agent, exact resources, operations, issuance/expiry, and revocation reference; maximum lifetime is 30 days. External disclosure defaults to 24 hours and has a hard seven-day maximum, additionally binding provider and destination.

Grant scopes are strict, sorted canonical lists and the grant reference is the
domain-separated hash of the exact signed envelope bytes. Revocation uses the
precommitted revocation reference and a separately signed `grant-revoke`
envelope binding the exact grant hash, issuer, time, and reason. A broker may
cache these only inside its rollback-resistant encrypted native index. Release
still requires revocations to be committed into the fresh signed authority log;
a merely hosted revocation row is not sufficient because the host could hide
it.

Jobs are endpoint-signed and sealed requester-to-broker with the requester's
X25519 private key and the broker's enrolled public key. Results reverse that
key-agreement direction, are broker-signed, bind the exact originating signed
job hash, and are sealed to the requester. No epoch key is used as a job key:
that would hide plaintext from the server but would let every endpoint holding
the epoch decrypt a broker-addressed job. The signed result envelope also binds
the terminal `completed` or `failed` state (integer field `105`), so the hosted
relay cannot flip UI-visible outcome metadata independently of the ciphertext.
Signatures and exact recipient/job/grant coordinates are verified before box
decryption releases plaintext. The broker persists a seen-set for unexpired
random job IDs and rejects replay. Offline jobs remain encrypted at the hosted
relay until lease/expiry.

For external-model work, the broker validates a fresh control-log head and the exact disclosure, decrypts only scoped resources, connects directly to the named provider, retains plaintext only for the active tool loop, and emits a content-free disclosure event. Revocation stops future transmission; it cannot recall provider-held data.

## Enrollment and recovery ceremonies

- First device generates endpoint keys, epoch 1, and a 256-bit recovery secret;
  encodes that exact entropy as a 24-word BIP39 code; requires full echo-back
  plus checksum confirmation; writes and verifies the signed genesis records.
- Add-device generates keys on the new device. An existing endpoint verifies a QR/short-authentication string over both public identities, vault ID, and nonce before signing enrollment and boxing the current epoch key. The server cannot produce a valid enrollment.
- Broker enrollment is the same ceremony with signed role `broker` and `unattended=true`.
- Recovery uses the full-entropy code to unseal the current epoch on a fresh device, enrolls that device, immediately removes old endpoints through forced rotation, and issues a new single-use recovery secret.
- Lose every endpoint and the recovery code and the vault is permanently unrecoverable. Support has no bypass.
- Broker replacement enrolls the new broker, drains/expires outstanding jobs, then removes and rotates away from the old broker. Broker uniqueness is checked against signed endpoint state.

`anc/v1` freezes recovery derivation as follows: the Argon2id password is the
exact 32-byte entropy decoded from a checksum-valid 24-word BIP39 code, the salt
is the exact 16-byte native-generated vault ID, and the cost/output parameters
are the suite constants. Mnemonic text is display and confirmation encoding,
not KDF input; this removes Unicode normalization and whitespace ambiguity. The
same vault ID remains the salt when a recovery ceremony issues a fresh random
recovery secret. Recovery generation then separates the downstream signing and
key-agreement authorities. The salt is public by design and is recoverable from
the signed vault state; the secret entropy, Argon2 root, private authority keys,
and unwrapped epoch key never leave trusted native memory.

This rule adds no `anc/v1` wire field: signed genesis already binds the vault ID,
recovery generation and identity, both recovery public keys, and the exact
recovery-wrap hash. A different vault ID derives a different authority and
cannot satisfy those commitments. An offline recovery package must retain the
public vault ID, the committed recovery wrap, and a latest signed-head
commitment; the 24 words alone neither identify a vault nor defeat a malicious
server withholding newer signed state. No real `anc/v1` vault may be created
until native/Core parity proves this derivation. A vault ever created with a
different salt rule must be explicitly versioned and migrated, never silently
reinterpreted.

The older `AncV1RecoveryEnvelope` lifecycle codec is a parallel synthetic
sealed-EEK compatibility envelope with an explicit arbitrary salt. It is not a
recovery descriptor, is not bound by genesis, and is not the signed
recovery-authority/recovery-wrap path. Its frozen vector remains decodable only
for interoperability compatibility. Native PREPARE and every new vault must not
create or consume it; changing that envelope's salt semantics would require an
explicitly versioned protocol migration.

## Dependency freeze

Current registry and official-source verification on 2026-07-16 selected:

| Package                   | Frozen candidate | Role and decision                                                                                                                |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sodium-native`           | `5.1.0`          | Broker/Electron-main primitive provider; native build and Electron packaging must be proven.                                     |
| `libsodium-wrappers-sumo` | `0.8.4`          | WASM compatibility/vector runner only where native modules are unavailable.                                                      |
| `@noble/ed25519`          | `3.1.0`          | Hosted public-signature verification only.                                                                                       |
| `@noble/hashes`           | `2.2.0`          | Hosted public hashing only.                                                                                                      |
| `cborg`                   | `5.1.7`          | Deterministic RFC 8949 encoding using `rfc8949EncodeOptions`; strict decode plus application-level canonical re-encode equality. |
| `@scure/bip39`            | `2.2.0`          | Full-entropy 24-word recovery-code encoding.                                                                                     |

`cbor-x` was explicitly rejected for signed bytes: its current official documentation establishes RFC 8949 conformance but does not promise the deterministic mode required here. Base `cborg` documents deterministic encoding and an explicit RFC 8949 option; its extended mode is forbidden. Runtime dependency installation remains a separate reviewed change with fixed vectors and exact lockfile evidence.

Rejected designs include raw JSON signing, JOSE/JWT/JWE algorithm headers, server KMS/HSM vault keys, WebCrypto AES-GCM content encryption, PGP, MLS for the single-user beta, derived per-object keys, hand-rolled streaming AEAD, and a server-side enrollment/support escape hatch.

## Release-blocking invariants

- Full hosted SQL/blob/log/audit/job dumps contain no known plaintext or decryption keys.
- Every hosted write passes the M2 validator; nested metadata fuzzing rejects non-allowlisted content.
- Wrong recipient/object/revision, replay, rollback, fork, removed endpoint, corrupt frame, missing final tag, stale grant/head, unknown suite, and result swapping all fail closed.
- A malicious relay harness may withhold, reorder, replay, fork, and inject unsigned endpoint state; it obtains no plaintext or enrollment authority.
- Canonical bytes and signatures are identical across Node/Electron/native/WASM vector runners.
- No nonce repeats for a key in the fixed corpus.
- Unsupported beta features have executable fail-closed tests.
- No support/operator surface can inject endpoints, keys, grants, or recovery.

## Implementation gate

M3 is an **unconditional independent-review GO** for beginning the opaque hosted
plane and authenticated runtime implementation. The gate closed after:

1. Generate and commit fixed known-key/known-byte vectors for every envelope type using the frozen field tables, domain tags, caps, and lifetimes.
2. Independently review the first-device, add/remove-device, rotation, recovery, broker replacement, grant/revocation, disclosure, and deletion state-machine transcripts.
3. Prove native and WASM canonical/vector parity in CI.
4. Commit the malicious-relay harness skeleton and nested hosted-write fuzz guard.
5. Freezing recovery as endpoint/recovery-mediated authority with no support or
   hosted-server path that can inject endpoints, keys, or grants.

The test-only native rotation-preparation corpus freezes exact wire parity with
BLAKE2b-256 commitments rather than publishing secret-bearing bytes. Its v2
schema commits all 12 endpoint/broker phase records, the shared primary outer
spool frame and a valid alternate substitution frame, their checksums, AAD, KDF input and derived-key commitments, ciphertext,
and frame digests. Each negative case also carries its baseline, mutation
surface, effective byte mutation, and checksum-repair instruction so native
runners can reproduce all spool and binding failures independently. Raw pending
keys, 512-byte records, inner spools, signed entries, and recovery wraps remain
absent from committed fixtures and source; test-runtime copies are zeroized.

Native parity runners pipe
`pnpm --filter @agent-native/core exec tsx scripts/materialize-native-rotation-preparation-vectors.ts --ephemeral-material-stdout`
directly into the native harness. Stdout contains only the `ANVRMS02` binary
stream: a fixed 152-byte little-endian header with version, flags, five bounded
payload lengths, primary vault, ceremony, endpoint, and broker IDs, and alternate
vault and ceremony IDs; the pending key, nonce, signed entry, recovery wrap, and
fully valid alternate outer frame; then a domain-separated BLAKE2b-256
checksum. Parsers reject bad magic, version, flags, header or payload lengths,
truncation, trailing bytes, and checksum mismatch. Producers and consumers
zero buffers after use; raw stream bytes may never touch disk, fixtures, source,
logs, reports, the source corpus, or packages.
The fifth payload is bounded by the encrypted spool contract at exactly
`1,114,424` bytes: 108 header bytes, the `1,114,268`-byte maximum inner spool,
the 16-byte AEAD tag, and the 32-byte outer checksum.

The final review required five adversarial ceremony passes. It verified
signed/head-bound lifecycle events, immediate role-aware signer removal,
endpoint/broker separation, collision-resistant candidate enrollment, and
complete pre-recovery endpoint-set pruning. It returned `UNCONDITIONAL GO` with
no new executable contract blocker. The Core E2EE corpus passes 96 tests across
10 files, including 14 fixed envelopes and native/WASM parity.

This closes design uncertainty; it does not pretend the runtime already exists.
Authenticated signature verification, durable hash-chained transcript replay,
real out-of-band SAS comparison, secure endpoint key storage, and operational
post-compromise broker replacement remain hard implementation requirements for
the broker/desktop milestone.

Fork runtime checkpoint: the native desktop trust anchor now decodes,
round-trips, hashes, and verifies the frozen `anc/v1`
`genesis-recovery-confirmation` and `genesis-bootstrap-transcript` artifacts.
The production XPC build includes those verifiers and the full genesis
authorization verifier. The native corpus matches the exact positive bytes and
rejects all 72 bootstrap and 205 authorization wire, size, range, signature,
vault, ceremony, endpoint, confirmation, control-log, and digest failures.

The runtime now durably stages the three public genesis artifacts, freshly
re-verifies them after restart, binds them to exact pending g1 custody, commits
the authority/custody transition to anchored g2, rereads the official tuple,
and cleans up only after proof. Production startup discovers and drains every
validated staged ceremony before opening the XPC request surface. Directory
ancestry, initial and reopened parent fsync, corruption, substitution,
concurrency, clock failure, and every observed Keychain mutation ambiguity are
covered. The request boundary remains public-artifact-only and is not exposed
to a hosted webview. Final-source arm64 execution and all non-x86 gates pass;
the final-source x86_64 coordinator rerun is still required because Rosetta
wedged before entering the runner.

This proves crash-safe commit and restart reconciliation, not complete
first-device enrollment. Native entropy, checksum-valid 24-word English BIP39
round trip, full-phrase constant-time confirmation, frozen Argon2id root, and
generation-separated recovery-authority derivation now match Core on arm64 and
have an independent implementation-review GO. The bounded decoder keeps phrase
handling out of immutable Foundation objects, checks the complete vendored word
order against the pinned oracle, rejects confusables and malformed UTF-8, and
is compiled into production without any XPC/addon/preload operation.

Native genesis preparation now constructs and signs the exact recovery wrap,
recovery confirmation, bootstrap transcript, endpoint envelope, sequence-zero
membership entry, and genesis authorization inside the desktop trust boundary.
Before returning public bytes it independently verifies the wrap, actually
unseals the wrapped epoch-one EEK and compares it in constant time, verifies the
bootstrap and authorization, and replays the signed control entry. Endpoint
private keys and recovery authority private keys remain guarded and are closed;
the four caller-owned guarded inputs are borrowed synchronously and remain open.
The native runner matches all five public outputs byte-for-byte against a
checksummed, runtime-only Core oracle, rejects mutation and binding attacks, and
writes no secret fixture. Production and focused arm64 builds, 204 Core E2EE
tests, Core/Desktop typechecks, and the Core distribution build pass.

The native trust boundary now also has a durable genesis-PREPARE storage layer.
It persists the fixed 1,024-byte preparation record and five 32-byte secret
inputs only through guarded memory into typed, nonsynchronizable,
device-bound Keychain services; the 48-byte bearer capability is never
persisted. Public artifacts use generation-two, checksum-bound frames and an
owner-only preparation index with atomic write, fsync, exclusive promotion,
strict file-type/link/mode validation, bounded enumeration, and restart
reconciliation. The Store reconciles stage, generation fence, and live record
before publishing state, exposes secrets only after full capability
verification, retires marker-only orphans and cleaned terminal markers, and
cannot generically transition lifecycle state or delete live artifacts. The
arm64 production/focused runner covers every persistence fault boundary,
substitution, same-lookup capability collision, concurrent idempotent create,
pending-fence recovery, cleanup failure, and 300-ceremony marker reuse; the
Record, ArtifactStore, Store, Keychain, and generation-fence suites pass with an
independent storage-slice GO.

Genesis authority operations now share one exact, recursive per-vault lock
identity across legacy commit/resume and the preparation path; equal vault IDs
serialize while distinct vaults do not share a stripe, and idle attacker-chosen
IDs do not remain pinned in an unbounded registry. Custody also has a dedicated
confirmed-genesis g1 installer instead of requiring a caller-authored snapshot.
It canonicalizes and owns every identity and public commitment, copies all five
pairwise-disjoint secret inputs into a guarded 160-byte snapshot, derives and
checks the endpoint public keys, durably reconciles the exact pending g1 shape,
and returns an immutable checkpoint containing the full wire-record fence
digest. Mutation, alias, substitution, ambiguous-write, KVC, concurrency, and
readback tests pass with an independent GO. No custody row is created while a
ceremony is merely PREPARED: only explicit confirmation may enter COMMITTING
and install g1 with the authenticated bootstrap digest.

The preparation store now owns the first proof-bearing production transitions.
It freshly verifies the recovery wrap, complete recovery confirmation,
bootstrap transcript, authorization, and signed control-log replay before it
may bind `CONFIRMED`; a caller cannot supply the next record or its
commitments. PREPARE retains a zero confirmation-time tuple. Confirmation
requires an exact millisecond-to-second boundary and binds every signed
created-at value to that one confirmed second, avoiding truncation and
caller-selected timestamp drift. The store then promotes the exact staged
artifact frame, enters `COMMITTING`, independently rereads the exact pending-g1
custody tuple, and binds its full generation-fence record digest. Every step is
exactly idempotent across ambiguity. Wrong handles disclose no state,
substitution and caller mutation conflict, and production still has no generic
lifecycle transition or live-delete surface. This closes the store-level
confirmation and pending-custody seam and gives the native coordinator only the
proof-specific operations needed for the next boundary.

The native coordinator now performs that complete handle-authorized path. A
new PREPARE generates the vault, ceremony, endpoint, envelope, nonce, recovery,
device, local-state, and epoch-one material inside guarded native memory; only a
guarded 48-byte handle and guarded checksum-valid mnemonic leave the
coordinator. PREPARE writes neither custody nor authority state. Confirmation
accepts the fully decoded recovery entropy rather than mnemonic text, compares
all 32 bytes in constant time, rebuilds the deterministic signed artifacts,
installs pending g1, commits official encrypted g2 through the existing
AuthorityStore boundary, rereads both official stores, binds the exact frame
digest, and terminalizes all five preparation secrets. The same handle is
idempotent after commit. A wrong entropy leaves custody and authority absent.
The arm64 production build and full synthetic coordinator ceremony pass. This
native API remains internal and is not yet a trusted user-facing ceremony or a
restart-without-handle startup path.

Cancellation and expiry now have proof-specific native production paths too.
Cancellation never deletes custody as if it had not existed: pending g1 becomes
a local, unanchored cancelled-genesis g2 tombstone that retains only public
identity keys, binds the exact predecessor wire-record digest, and contains no
custody secrets. The preparation record binds the tombstone digest before its
own secrets are terminalized. A hardened authority-absence proof checks both
live and staged authority paths without misclassifying valid pending custody as
official state. PREPARED and CONFIRMED ceremonies with no custody prove custody
absence instead. Bound live artifacts, fully ceremony-bound orphan stages, and
the coordinator's separate vault-bound genesis spool are each deleted through
narrow authenticated methods before cancellation reports success. The
predecessor g1 digest is the idempotency key, and a retry reuses the tombstone's
original cancellation time rather than the later wall clock. Expiry is narrower: only PREPARED may expire,
only strictly after its durable deadline, and only with custody and authority
absent. The affected codec, repository, authority, storage, and end-to-end
coordinator suites pass on current-source arm64, including every custody fence
fault, ambiguous writes, concurrency, substitution, orphan-stage cleanup,
cancellation before confirmation, and cancellation after pending custody but
before official authority.

Startup orchestration no longer depends on a caller-held bearer. The actual
bearer suffix is deterministically derived with keyed BLAKE2b from the guarded
local-state key and the preparation lookup, vault, and ceremony identifiers.
Only the digest is stored; the native startup coordinator reconstructs the
bearer in zeroized scope and uses the same proof-bound operations as an
interactive retry. This does not grant startup confirmation authority:
PREPARED remains pending or expires, while only already CONFIRMED or COMMITTING
records may continue. Production constructs the preparation stores and keeps
XPC closed until preparation and official-artifact sweeps succeed. Startup
observes the persisted time floor unconditionally, repairs marker-only crashes,
finishes proof-bound CANCELLED/EXPIRED cleanup before retiring their markers,
and rejects a COMMITTED record whose hosted receipt has not authorized cleanup.

The system clock is also fenced by a separate device-wide Keychain store.
Authenticated current and high-water frames advance through pending and stable
generations. A backward clock, corrupt or missing pair, or inaccessible storage
fails closed; the stored floor is never silently substituted for rolled-back
time. Every initialization/update write boundary and restart direction is in
the arm64 synthetic corpus. This pair is crash-consistent and detects local
wall-clock rollback, partial loss, and corruption; it is not an independent
monotonic anchor against coordinated restoration of both valid Keychain
frames. A remote or hardware witness is required before making that stronger
anti-rollback claim.

PREPARE is now exposed only through a signed native AppKit confirmation
ceremony, authenticated XPC, the fixed N-API addon, and narrow Electron IPC.
The hosted account authorizes and durably admits the opaque candidate before
local cleanup; recovery phrases and private key material never enter hosted or
web JavaScript. Committed local cleanup independently verifies the official
tuple, retained signed genesis entry, recovery wrap, and distinct canonical
sequence-zero hosted receipt. It persists the exact receipt, binds its frozen
domain-separated digest, deletes only the authenticated artifact, and
completes CLEANED across each crash boundary. It does not synthesize
acknowledgement from local authority and does not turn the cancellation-only
digest-bound delete into a raw live-delete or caller-authored transition API.

Mnemonic recovery now enters through a separate native AppKit secure-entry
ceremony. The addon first obtains only the strict parser's public vault label;
the 24-word phrase then crosses the authenticated XPC boundary directly and is
never an addon argument or typed JavaScript result. A native replay session
pins one vault and hosted head, verifies genesis candidate/account admission,
derives the committed recovery authority, replays every control edge and typed
evidence object, authenticates every active recovery wrap, and requires all
wraps to unseal the same EEK. Completion requires the exact current wrap and
final replayed head. Any malformed page, gap, substitution, wrong EEK, or
corrupt final wrap invalidates and clears the session. Dual-architecture replay,
control-log, authorization, derivation, protocol, and universal-build proof is
green. Verified replay deliberately does not yet claim recovered custody:
durable installation of fresh-device custody and its recovered endpoint edge
remain the next implementation gate.

Capability revocation now has a first executable authority-log edge. Core
encodes the exact signed `grant-revoke` envelope as bytes inside an
endpoint-signed `grant_revocation` control entry and refuses to advance the
head until a trusted authorization callback accepts it. Broker signatures,
missing callbacks, callback rejection, unknown wire fields, and mutation of
authenticated snapshots all fail closed. The native reducer consumes the same
strict four-field inner envelope and passes the exact outer entry, inner entry,
embedded revocation bytes, and authenticated prior state to its authorization
boundary before state reduction. The regenerated `@3` Core/native corpus now
replays twelve accepted edges and 101 adversarial cases identically on arm64
and x86_64. This establishes ordered, non-hosted revocation authority; the
callback must still durably verify and insert the nested revocation in the
encrypted native grant/replay index before returning success.

The native boundary now also has a Core-parity grant codec. It verifies the
fixed canonical field sets, sorted resource/operation/provider scopes, exact
16-byte identities, 30-day maximum lifetime, issuer and vault binding, grant
expiry, precommitted revocation reference, exact signed-byte grant hash, and
the `grant` and `grant-revoke` detached signatures. The fixed Core grant and a
paired signed revocation pass byte-for-byte on arm64 and x86_64; wrong keys,
vaults, expiry, altered signatures, and mismatched revocation references fail
closed. The codec is pure verification and does not yet claim durable replay
or revocation enforcement until the encrypted index owns it.

The native endpoint now owns that first durable grant/revocation boundary. Its
owner-only index stores only authenticated ciphertext derived from the guarded
local-state key, binds the vault and generation as associated data, and fences
every staged promotion with an authenticated Keychain generation record. A
missing, stale, corrupt, or restored live frame fails as rollback; pending
crashes recover only the exact staged or promoted digest, and uncommitted stage
and bounded temporary artifacts are removed without being trusted. Grant
insertion re-verifies issuer, signature, lifetime, and canonical scope;
authorization re-verifies the exact subject and requested resource, operation,
and provider at the current time. Revocation replay is accepted only from the
same authenticated control endpoint and signing key as the original grant, and
the control-log verifier cannot advance its head until this durable insertion
succeeds. Encryption, persistence, restart, stale-stage cleanup, tamper and
rollback detection, authorization, and revocation pass on arm64 and x86_64.
The same encrypted generation fence now owns the broker's unexpired job
seen-set. Claiming a random job id atomically re-verifies the live grant and its
exact account, endpoint, optional agent, resource, operation, and provider
scope, then persists the job hash, requester keys, expiry, and scope before an
execution may be accepted. A duplicate id is replay even when every supplied
byte is identical. Locally sealed results bind a terminal state and exact
result-envelope hash to that claim with conflict-safe idempotency. Expired
claims are pruned only inside a newly fenced claim commit; neither load nor a
hosted retry can silently erase replay history. Dual-architecture restart,
replay, result substitution, encrypted-at-rest, tamper, and rollback proof is
green. Core and native code now also share one exact canonical semantic-job
plaintext: vault jobs must bind a 16-byte resource, strict operation and
provider tokens, and one bounded opaque action body. The signed-native job
processor loads a fresh rollback-checked authority snapshot, requires exactly
one active unattended broker, resolves the grant's requester only from active
membership, proves local broker custody and box-key continuity, verifies and
opens the signed job, parses its semantic scope, and completes the atomic claim
before returning only the action body. Replaying the exact signed ciphertext is
denied. This path is now reachable through one bounded `open_job` operation in
the code-signature-pinned XPC protocol and universal N-API addon; the trusted
main-process client maps it to the reusable broker contract while ignoring the
caller's endpoint assertion for authority. The service resolves the actual
broker and requester from signed native state. The native processor now also
resolves the claimed requester's exact retained box key, rechecks the fresh
single-broker authority and local signing/box key continuity, seals the
terminal result in the reverse direction, and durably binds a
domain-separated hash of the exact result envelope before it may leave native
code. Result substitution and a second terminalization conflict. The bounded
`seal_result` XPC/addon operation and trusted main-process mapping
now expose only that requester-sealed envelope; result plaintext and native key
material never become addon inputs or outputs beyond the explicit local action
result body. Before the encrypted grant index records terminalization, the
native service now durably stages and promotes the exact requester-encrypted
result envelope in a pinned owner-only spool. A crash between that promotion
and the fenced index commit recovers the same signed ciphertext, verifies its
vault, job, job hash, requester, state, and broker signature, and records its
existing hash instead of invoking or encrypting the action again. Once the
index has recorded a result, a missing, substituted, malformed, or mismatched
spool frame fails closed. Dual-architecture tests cover interrupted commit,
restart, identical retry, conflicting bytes, unsafe modes, and symlink
substitution. The exact hosted-receipt acknowledgment now exists across the
reusable worker, trusted main-process contract, universal
addon, XPC protocol, and encrypted native index. Only a decoded hosted result
receipt with the claimed job, hash, and terminal state can advance the index
from `result` to `delivered`; the service commits that rollback-fenced state
before deleting the exact matching spool bytes, and the operation is
idempotent across a crash between those two steps. A local acknowledgment
failure after the hosted receipt preserves the spool and cannot move the
already-terminal hosted job back to retry. For the narrow post-receipt crash
window, the encrypted index now retains the authenticated
hosted epoch, retry count, and algorithm alongside the claimed job. Before a
new claim or action execution, native custody returns at most one exact pending
encrypted result; the worker idempotently resubmits it to the already
conflict-safe hosted result slot, verifies the returned coordinates, records
delivery, and zeroizes the transferred frame. Pending results are never pruned
merely because their original execution lease expired.

The hosted half of ordinary enrollment now uses the frozen ceremony directly.
A short-lived, account-scoped rendezvous retains only canonical public offer,
signed challenge, signed authorization, and content-free commit coordinates.
It cannot create or sign a step. Candidate key possession, the attended
authorizer, fresh control head, SAS transcript, endpoint identity, recipient
bound EEK wrap, and exact membership edge are verified before the membership
append and activation receipt commit atomically. A retry must reproduce the
same bytes, and a first-broker offer is rejected whenever replayed authority
already contains an active broker. The remaining lifecycle gate is the native
candidate/authorizer ceremony, explicit SAS confirmation, custody activation,
broker replacement, and the encrypted Content action registry. The canonical
Content action executor, native-bound semantic operation/resource coordinates,
cookie-free signed transport, authenticated runtime discovery, OS-encrypted
content-free checkpoint store, revocation verifier, and fail-closed Desktop
supervisor composition are now executable.

On a combined personal desktop, attended endpoint custody and unattended broker
custody are independent local principals. They use distinct Keychain record and
rollback-fence identities plus separate owner-only authority, grant, and result
state roots. The original endpoint record identifier remains stable; only the
new broker uses the broker domain. Handle revocation is keyed by custody domain
and vault rather than vault alone. The XPC service therefore cannot satisfy a
broker job or broker-route signature from the endpoint's signing seed, and an
endpoint lifecycle mutation cannot silently close or replace broker custody.
The two principals meet only through the signed enrollment/control-log
transcript and the epoch key explicitly boxed to the broker.

The design is approved only while it retains broker-direct disclosure, no server keys, endpoint-mediated enrollment, fixed suite/versioning, fresh random revision keys, epoch rewrap/destruction, short signed grants, and detection-based rollback defense.
