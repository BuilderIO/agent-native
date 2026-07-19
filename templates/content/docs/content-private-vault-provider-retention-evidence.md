# Content Private Vault Provider Retention Evidence

Evidence date: 2026-07-19

Scope: fork-owned synthetic lab only

Parent runbook: [Content Private Vault Beta Runbook](./content-private-vault-beta-runbook.md)

## Verified deployment mapping

The Vercel CLI reports that `agent-native-content-e2ee-lab-db` is an available,
owned Neon Free-plan resource connected only to the production, preview, and
development environments of `agent-native-content-e2ee-lab`. The Content lab
also uses the private `content-e2ee-private` Vercel Blob store. These are
synthetic fork resources, not production customer storage.

This evidence does not include provider credentials, connection strings, blob
URLs, or customer data.

## Where plaintext and ciphertext can remain

| Provider surface                   | Private Vault material                                                                                                     | Deletion and retention fact                                                                                                                                                                                                                                                               | Required evidence before a migrated vault is labeled complete                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon Postgres                      | Standard Cloud source rows are plaintext until scoped cleanup; Private Vault rows contain admitted metadata and ciphertext | Neon retains branch history for the project's configured restore window, and changing that window affects every branch. Retained snapshots have their own configured lifetime.                                                                                                            | Capture the exact `history_retention_seconds`, branch, and snapshot inventory before cleanup. After cleanup, prove the source rows are absent live and wait beyond the recorded restore window and every applicable snapshot expiry before claiming that recoverable legacy plaintext is gone. |
| Vercel Blob                        | Private Vault objects are `anc/v1` ciphertext. The supported first-beta migration has no plaintext media/blob payload.     | Vercel says deletion or overwrite may take up to 60 seconds to propagate through its CDN cache. Its public DPA describes regular backups and deletion in a commercially reasonable timeframe after contract termination, but does not publish a fixed per-object backup-erasure deadline. | Prove the migration created no plaintext blob object, then verify expected ciphertext objects and deletion/tombstone behavior. Disclose that ciphertext and metadata may remain in provider backups; do not claim immediate physical erasure.                                                  |
| Vercel deployment and runtime logs | No protected plaintext is admitted                                                                                         | Published legal terms treat telemetry and logs as provider system data and do not provide a workload-specific purge horizon.                                                                                                                                                              | Run exact known-plaintext scans over bounded build and runtime logs. Any match is a stop condition; time-based log deletion is not a substitute for preventing plaintext emission.                                                                                                             |

## Current provider sources

- [Neon project restore-window documentation](https://neon.com/docs/manage/projects)
  explains that project history powers instant restore and time-travel reads,
  that the window is configurable, and that it applies to all branches.
- [Neon snapshot retention announcement](https://neon.com/docs/changelog/2025-10-31)
  documents separately retained automated snapshots with configurable expiry.
- [Vercel Blob documentation](https://vercel.com/docs/vercel-blob) documents
  private authenticated reads, S3-backed durability, and up to 60 seconds for a
  deletion or overwrite to propagate through Blob's cache.
- [Vercel's current Data Processing Addendum](https://vercel.com/legal/dpa)
  documents regular backups and a commercially reasonable deletion commitment
  after termination, without promising a fixed per-object backup purge time.

## Fail-closed interpretation

The frozen 35-day backup-purge maximum is an Agent Native product contract, not
evidence that every provider already satisfies it. A production provider must
offer configuration and evidence that fit that maximum before real migration is
enabled. If the exact Neon restore window or snapshot expiry cannot be read, or
if recoverable source plaintext remains, migration may copy and verify but must
not receive the completed E2EE label.

Vercel Blob's unspecified physical backup-erasure time is not a plaintext
migration blocker because the supported migration writes only ciphertext there.
Deletion remains cryptographic: signed tombstones remove live wraps and the
subsequent epoch rotation destroys the old wrapping authority. Product copy
must continue to disclose retained ciphertext, metadata, sizes, timing, and
opaque access patterns.

## Exact canary record

For each candidate, append these content-free values to its evidence packet:

- fork commit and deployment ID;
- Neon project and branch aliases, plan, `history_retention_seconds`, and the
  timestamp at which the cleanup falls outside that window;
- snapshot count, identifiers or aliases, and latest applicable expiry;
- live source-row count before and after cleanup;
- private Blob store alias, ciphertext object count, and the timestamp at which
  a deleted object becomes unavailable through authenticated origin and cache;
- bounded deployment/runtime log ranges and zero known-plaintext matches; and
- reviewer decision that the provider evidence fits the 35-day contract.

An unknown value is recorded as unknown and blocks the corresponding deletion
claim. It is never replaced with a provider default inferred from plan name.
