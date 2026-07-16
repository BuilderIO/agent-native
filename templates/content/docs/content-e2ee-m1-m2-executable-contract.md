# Content E2EE M1/M2 Executable Contract

Status: frozen for protocol implementation; cryptographic primitives deliberately deferred to M3
Contract version: 1
Evidence date: 2026-07-16
Implementation route: [Content E2EE Implementation Wayfinder](./content-e2ee-implementation-wayfinder.md)
Plaintext inventory: [Content E2EE F3/F4 Evidence Matrix](./content-e2ee-f3-f4-evidence-matrix.md)

## M1 — personal-vault domain

Private Vault beta has one personal vault per account/workspace domain. A vault owns opaque protected objects, endpoint enrollments, key epochs, capability grants, disclosure envelopes, and encrypted jobs. A document belongs to exactly one vault and never changes cryptographic mode because a server feature flag changes.

The hosted service may authenticate an account, route opaque ciphertext, enforce grants over opaque identifiers, and retain the M2 metadata budget. It may not enroll a trusted endpoint by itself, recover a vault, decrypt an object, execute a vault tool loop in hosted plaintext, or silently route a protected operation to the legacy Content implementation.

Protected Content execution is placed on the enrolled broker. This preserves unattended agent use without giving the hosted Content server the vault key. When no eligible broker is available, work queues as encrypted material or fails closed; plaintext local fallback is forbidden.

The versioned schemas live in `@agent-native/core/e2ee`. The Content-specific policy lives in `shared/private-vault-privacy-manifest.ts`.

## M2 — protected fields

The protected set includes canonical document title/body/icon/hierarchy/source path and every server-readable derivative identified by F3: versions, comments, database values, source payloads, indexes/snippets, collaboration state, protected application state, chat/run/tool/audit/trace material, A2A and automation payloads, notifications, media and derived artifacts, imports/exports, provider payloads, and model prompts/results.

Protection follows the information, not the column name. A renamed field, JSON wrapper, summary, embedding, transcript, cache entry, or tool result remains protected when it contains or derives from vault plaintext.

Private Vault beta fails unsupported comments, databases, collaboration, public publishing, sharing, Notion/Builder/source sync, extensions, webhooks, provider API, transcription, media, Local File Mode, and plaintext import/export closed. A feature becomes available only after it gains an explicit encrypted implementation and its own adversarial proof.

## M2 — hosted metadata budget

The exact v1 allowlist is exported as `PERSONAL_VAULT_V1_HOSTED_FIELDS`. It admits only versioned opaque account/workspace/vault/object/endpoint/job/grant identifiers; endpoint public identity and state; key epoch and wrapped-key envelope; opaque algorithm identifier, ciphertext, ciphertext size and revision; coarse receive/lease/retry/health state; content-free access events; and capability-bound disclosure envelopes.

The admitted leakage is explicit: ciphertext sizes, coarse timing, network metadata, and opaque access patterns. Titles, body text, snippets, prompts, results, filenames, provider payloads, semantic tags, plaintext revisions, and decryption keys are not admitted.

`assertHostedFieldsAllowed` rejects any top-level field outside the allowlist and strictly validates nested admitted containers so protected material cannot be smuggled into revision or disclosure metadata. Ciphertext remains opaque bytes and is not recursively inspected.

## Retention and deletion

| Hosted class                                                                   | Live retention          | Deletion trigger  | Active purge   | Backup purge   |
| ------------------------------------------------------------------------------ | ----------------------- | ----------------- | -------------- | -------------- |
| Vault identifiers                                                              | While vault exists      | Vault deleted     | Within 30 days | Within 35 days |
| Object ciphertext, envelope, algorithm, epoch, size, revision and receive time | While resource exists   | Resource deleted  | Within 30 days | Within 35 days |
| Endpoint identity/state/health                                                 | While endpoint enrolled | Endpoint removed  | Within 30 days | Within 35 days |
| Job/grant routing state                                                        | Until job terminal      | Job terminal      | Within 30 days | Within 35 days |
| Content-free access and disclosure events                                      | 90 days                 | Retention elapsed | Within 7 days  | Within 35 days |

These are maximum contractual horizons, not permission to retain data that is no longer operationally needed. Later storage work must implement and prove each trigger. Backups are disclosed honestly until physical purge completes; a vault cannot claim completed legacy-plaintext deletion while recoverable plaintext remains in retained backups.

## Executable enforcement

- Core schemas reject unknown keys and malformed nested containers.
- The Content manifest parses at module load and freezes its placement, protected-field catalog, egress rule, leakage budget, retention table, and fail-closed feature list.
- Tests inject known protected title material into a hosted record and require rejection.
- The fixed failure corpus covers known plaintext, wrong recipient, replay, rollback, removed device, corrupted envelope, broker offline, and nested metadata leakage.
- The universal action-execution resolver denies protected actions without the declared endpoint placement and rejects malformed or placement-confused resolver decisions before local action code can run.

No encryption primitive, key derivation function, device-authentication scheme, or streaming format is selected here. That choice belongs to M3 and requires an independent cryptographic design review before runtime encryption code begins.
