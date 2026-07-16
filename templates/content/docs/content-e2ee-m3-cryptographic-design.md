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

## Object and stream format

Object headers bind suite, vault/object ID, monotonic revision, epoch, chunk count, plaintext length, content-type tag, DEK-wrap reference, writer endpoint, and signature. Titles and filenames live only inside ciphertext.

Single-frame content uses XChaCha20-Poly1305 with a random 24-byte nonce. Large content uses `secretstream` in fixed 1 MiB plaintext chunks, with per-frame associated data binding object, revision, chunk index, and count. The final frame must carry `TAG_FINAL`; truncation, reordering, splicing, wrong recipient/object/revision, any bit flip, or missing final tag fails with one opaque local `VaultCryptoError` and zero released plaintext.

Caps: 64 KiB control/log envelopes, 16 KiB object headers, 1 MiB chunks, 256 MiB objects, and 16 MiB encrypted job/result payloads.

## Control log, rollback, and deletion

Endpoint membership, epochs, grants/revocations, disclosures, recovery, object tombstones, and rotation acknowledgements form an endpoint-signed append-only hash chain. Each entry binds sequence, previous BLAKE2b-256 hash, signer, and canonical inner envelope.

Every endpoint persists the highest verified `(sequence, head hash)`. A lower sequence or conflicting hash at the same sequence is a hard rollback/fork failure. Before unattended work, the broker must refresh and verify a head no older than 15 minutes; a withholding server can stop work but cannot silently preserve stale authority.

Objects carry monotonic signed revisions and endpoints persist per-object high-water marks. The v1 format reserves signed vault-manifest snapshots mapping object IDs to current revisions so newly enrolled devices can detect object rollback. These snapshots are required before beta release.

Deletion writes a signed tombstone, destroys live DEK wraps, asks hosted storage to delete ciphertext, and becomes cryptographically unrecoverable after the next epoch rotation destroys the old wrapping key. Product copy must not promise instant backup erasure.

## Grants, jobs, and disclosure

Possessing a grant never conveys key material. Internal agent grants are endpoint-signed and bind subject endpoint/agent, exact resources, operations, issuance/expiry, and revocation reference; maximum lifetime is 30 days. External disclosure defaults to 24 hours and has a hard seven-day maximum, additionally binding provider and destination.

Jobs are endpoint-signed and sealed to the broker. Results are broker-signed, bind the originating job hash, and are sealed to the requester. The broker persists a seen-set for unexpired random job IDs and rejects replay. Offline jobs remain encrypted at the hosted relay until lease/expiry.

For external-model work, the broker validates a fresh control-log head and the exact disclosure, decrypts only scoped resources, connects directly to the named provider, retains plaintext only for the active tool loop, and emits a content-free disclosure event. Revocation stops future transmission; it cannot recall provider-held data.

## Enrollment and recovery ceremonies

- First device generates endpoint keys, epoch 1, and a 256-bit recovery secret; displays a 24-word or equivalent full-entropy code; requires echo-back confirmation; writes and verifies the signed genesis records.
- Add-device generates keys on the new device. An existing endpoint verifies a QR/short-authentication string over both public identities, vault ID, and nonce before signing enrollment and boxing the current epoch key. The server cannot produce a valid enrollment.
- Broker enrollment is the same ceremony with signed role `broker` and `unattended=true`.
- Recovery uses the full-entropy code to unseal the current epoch on a fresh device, enrolls that device, immediately removes old endpoints through forced rotation, and issues a new single-use recovery secret.
- Lose every endpoint and the recovery code and the vault is permanently unrecoverable. Support has no bypass.
- Broker replacement enrolls the new broker, drains/expires outstanding jobs, then removes and rotates away from the old broker. Broker uniqueness is checked against signed endpoint state.

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

The design is approved only while it retains broker-direct disclosure, no server keys, endpoint-mediated enrollment, fixed suite/versioning, fresh random revision keys, epoch rewrap/destruction, short signed grants, and detection-based rollback defense.
