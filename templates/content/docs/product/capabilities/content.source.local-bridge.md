---
record_type: "capability"
spec_version: 2
id: "content.source.local-bridge"
name: "Local Source bridge"
user_promise: "A trusted device can synchronize explicitly selected local Sources while browsers remain useful without inheriting filesystem authority."
primary_user_job: "Work with a local folder across devices without exposing its path, handles, or direct filesystem power to every browser."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "desktop"
dependencies: ["content.source.adapters", "content.source.sync-policy"]
related_features:
  [
    "content.feature.bring-your-local-work",
    "content.feature.take-the-whole-vault-with-you",
    "content.feature.keep-your-private-vault-private",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A device-authorized bridge holds selected-root authority locally, synchronizes access-scoped materializations through the Source contract, validates every physical operation and base revision, queues permitted write-back truthfully, and lets unsupported clients use the last authorized representation without receiving filesystem authority."
proof_requirements:
  [
    "Device pairing, root grants, capability revocation, path containment, payload bounds, and origin/client authorization tests",
    "End-to-end bridge synchronization, base-version conflict, queue, retry, receipt, disconnect, and degraded-client workflows",
    "Security and privacy review proving raw paths/handles stay local and no webpage or browser client gains general filesystem or command authority",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Local Source bridge

## Why this exists

A local folder should participate in the same Content workspace without making
the folder a shared database or granting every browser the ability to inspect a
device. Some clients can hold a user-granted folder capability; many cannot.
The bridge keeps that difference honest while preserving ordinary Content work.

## Example workflow

A person grants a trusted desktop app access to one documentation folder. The
bridge materializes authorized files into Content and watches the granted root.
Later, a browser without local-file capability reads the last synchronized
representation, adds a permitted source-owned edit, and sees **waiting for
local access** rather than **synced**. When the trusted device returns, the
bridge checks the base revision, writes or raises a conflict, and emits a
receipt. The browser never receives the folder path or direct file handle.

## Product contract

### One narrow device-authorized protocol

- The Local Source Bridge is one Source-adapter protocol. A trusted desktop app
  implements it first; a lightweight helper or optional browser transport may
  later use the same contract rather than create separate sync engines.
- A person explicitly selects roots and grants read and write capability
  separately. Hosted Content stores opaque connection IDs, Source metadata,
  baselines, and access-scoped materializations, never raw paths or operating
  system handles.
- Every physical operation validates the paired client/origin, connection,
  granted root, operation capability, normalized relative path, payload bound,
  and base version. Traversal, root escape through symlinks, arbitrary shell
  execution, and a general webpage-to-native command channel are prohibited.
- The bridge reads, watches, and writes only declared Source representations;
  it uses the same policy, conflict, Event, and receipt contract as other
  adapters.

### Degrade without pretending authority exists

- A browser or device that lacks persistent folder access can read the last
  access-authorized SQL materialization and continue SQL-owned work such as
  Views, Queries, memberships, collaboration, and Content-owned properties.
- It does not inherit desktop filesystem authority. Direct local-only actions,
  such as immediate physical writes or opening bytes never materialized, are
  unavailable on that client and identify the applicable trusted route.
- When policy permits, source-owned outbound edits can queue with their base
  version until an authorized bridge returns. Queued, stale, unavailable,
  conflict, failed, and provider-confirmed states remain distinct.
- The normal interface stays quiet until a requested operation genuinely needs
  unavailable local bytes or authority. Loss of a bridge narrows the Source on
  that client; it does not hide the Source or make unrelated Content read-only.

### Keep custody and recovery explicit

- Reconnection refreshes freshness before applying queued work. Incompatible
  upstream edits enter review rather than overwriting local files.
- Each bridge operation produces ordinary actor/origin-aware Events and sync
  receipts. Retries use stable identity and must not duplicate physical effects.
- Disconnecting or revoking a bridge grant stops future device access and never
  deletes external originals. Treatment of any Content materialization is an
  explicit separate decision under Source policy and portability rules.

## Boundaries and non-goals

- Files and folders as Sources owns how a selected tree materializes as Content
  records. This bridge owns device authority and transport, not a second Files
  product.
- Sync policy owns View only, Keep in sync, and Review before write-back;
  adapters own capability declarations. The bridge implements those contracts
  for local authority.
- This Capability does not require every browser to install an extension, make
  a browser's folder picker equivalent to desktop authority, or expose a
  loopback service to arbitrary webpages.

## Acceptance stories

### Synchronize without disclosing a local path

Given a person grants one root to a paired bridge, when the bridge synchronizes
an authorized file into Content, then shared records contain only opaque Source
connection and representation metadata, while the raw path and handle remain
on the device.

### Queue honestly on an unsupported client

Given a browser without local bridge capability and a Source policy that permits
write-back, when an editor changes a source-owned field, then Content records a
base-versioned queued change and shows a waiting state; it does not claim the
file changed or grant the browser direct access to the folder.

### Block root escape and preserve the original on disconnect

Given a paired bridge receives a write request whose path escapes the granted
root, when it validates the request, then it rejects the operation with no file
mutation and an honest failure. Given the owner later disconnects the Source,
then the bridge stops access without deleting the original local file.

## Current evidence

Local File Mode, connected-folder Sources, conflict records, and trusted local
bridge pieces provide substantial foundation. They do not yet prove dependable
background synchronization, uniform device pairing/revocation, browser queue
behavior, or the complete protocol security and recovery contract. This
Capability remains `approved_shape`.

## Proof plan

1. Test root selection, pairing, origin/client allowlists, separate read/write
   grants, revocation, normalized paths, symlink escapes, oversized payloads,
   and rejected operations without filesystem side effects.
2. Exercise initial materialization, watch refresh, authorized write-back,
   queues, reconnect freshness checks, conflicts, retries, receipts, pauses,
   and disconnect across a desktop bridge and an unsupported browser client.
3. Verify access-scoped materialization and changing Content permissions never
   convert one person's device grant into another person's filesystem access.
4. Complete the real interface workflow for selection, degraded states,
   contextual unavailable operations, recovery, and accessible status text.

## Open questions

- The exact pairing ceremony, background-service packaging, and optional
  browser transport remain open provided they preserve the one narrow protocol.
- Cache retention, offline capacity, and the detailed user choice for retaining
  materialized Content on disconnect need portability design.
