# Provider write queue contracts

The shared queue persists a caller-scoped intent and its receipt so retries use
the same idempotency identity. Pending or uncertain progress does not establish
that a provider write failed, and cancelling client polling does not cancel the
durable intent.

## Client results

`waitForProviderWriteResult` recognizes an initial queued action result through
its explicit `_providerWrite` marker. An ordinary action result can contain a
`progress` field and remains unchanged. After a marked write starts polling,
the resume callback may return the server's `{ progress, result? }` envelope;
only a completed receipt with a result resolves to the original action result.
Permanent action-access or contract refusals remain their original errors.
Pending progress remains available to the caller without a shared write-failure
notification.

## Receipt retention

Terminal receipt identity, accepted input and stored results are currently
retained for durable idempotency and authorized result retrieval. There is no
automatic expiry or pruning of terminal receipts, and pending or uncertain
intents are not automatically pruned. This is not a bounded retention policy.

Automatic TTL or payload compaction is deferred until persistent tombstones can
preserve caller-scoped deduplication and explicit result-expiry semantics.
Removing an idempotency identity would let an old retry dispatch the write
again; removing only its result would make a completed retry unreadable unless
the receipt explicitly reports result expiry. A future retention mechanism must
preserve those contracts rather than treating expired records as new intents.
