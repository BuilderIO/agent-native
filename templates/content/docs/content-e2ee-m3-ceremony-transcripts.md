# Content E2EE M3 Ceremony Transcripts

**Status:** normative ceremony contract for M3 review  
**Scope:** control-flow and evidence requirements only; this document does not
select or implement cryptography  
**Protocol:** `anc/v1`; unknown versions fail closed

This contract turns every high-risk key or disclosure operation into a strict,
resumable state machine. A ceremony can be `active`, `incomplete`, `alert`,
`committed`, or `aborted`. It is successful only after an endpoint-signed append
to the control log verifies the previous head. “We got most of the way there” is
an incomplete ceremony, not success wearing a jaunty hat.

The serialized state and evidence are content-free. They may contain opaque IDs,
bounded status codes, counters, binding references, and boolean verification
results, but never keys, plaintext, document names, prompts, provider payloads,
or recovery material. Every event binds its ceremony ID, vault ID, current epoch,
actor, and monotonic timestamp. Signed seams additionally bind the signer and
previous log head; SAS and key-destruction seams bind their transcript or epoch.
Ceremony start state freezes the expected control-log head and role-tagged
enrolled signer set (`endpoint` or `broker`),
and any expected SAS, pre-recovery snapshot, or live-wrap-set reference. Later
evidence must equal those values; mere presence is never sufficient.

## Common transition rules

1. An endpoint or the recovery authority starts a ceremony. The hosted server
   cannot start one, enroll an endpoint, or complete a step. A server-started
   alert cannot be acknowledged into a resumable ceremony; neither can any
   server-originated security alert. It must be discarded or signed-aborted and
   restarted by an authorized actor.
2. Only the declared next step can complete. An out-of-order step enters
   `alert` without advancing.
3. A user endpoint may pause an active ceremony. It becomes `incomplete` and
   retains the exact next step. Resume is possible only from `incomplete`.
   Pause and abort are forbidden while disclosed plaintext remains outstanding;
   the broker must record destruction first.
   Pause, alert acknowledgement, and resume each require an enrolled endpoint's
   signature, exact expected-head binding, and signer/actor identity equality.
4. A security failure enters `alert`. Acknowledgement moves it to
   `incomplete`; it does not waive or complete the failed invariant.
5. Abort requires an endpoint signature and verification of the previous log
   head. It is durably recorded as `abortLogged`, preserves both its abort reason
   and any triggering alert, remains distinct from `signedLogCommitted`, and is
   terminal.
6. Every signed transition verifies the previous log head. Commit independently
   requires an endpoint signature and previous-head verification. Committed and
   aborted transcripts are immutable.
7. Any plaintext fallback attempt is an alert. There is no downgrade or hosted
   plaintext relay path.
8. Recovery authority is accepted only inside a recovery ceremony. Persisted
   completed steps must be an exact prefix of the ceremony sequence, and the
   reducer derives the sole valid next step. Forged state is rejected.
9. Timestamps never move backward. A regressing event creates an alert without
   replacing the last accepted timestamp.
10. Broker initiation is accepted only for direct disclosure, and recovery
    initiation only for recovery. Enrollment signatures must come from the
    frozen enrolled-signer set. Genesis is the sole exception; a candidate can
    never sign its own enrollment.
11. Candidate identity is persisted when keys are generated. SAS evidence,
    epoch-key recipient, recovery snapshot, and deletion wrap-set evidence must
    equal the references frozen or generated earlier in the same transcript.
    A generated candidate ID must not equal any enrolled endpoint or broker ID.
12. A server alert remains non-resumable, but it cannot strand plaintext. The
    enrolled broker may record the exact `plaintext_destroyed` step while the
    ceremony is alert or incomplete; the original status and alert remain until
    signed abort or an otherwise-authorized continuation.

## Successful transcripts

The following rows are ordered. Every arrow is a durable transition, and every
final `signed_log_committed` step is mandatory.

| Ceremony                   | Ordered transcript                                                                                                                                                                                                                                                                                                         | Required evidence at the critical seam                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First device               | `endpoint_keys_generated` → `recovery_secret_generated` → `recovery_secret_confirmed` → `epoch_created` → `endpoint_enrollment_signed` → `signed_log_committed`                                                                                                                                                            | Genesis starts at epoch 1 with no broker; recovery secret echo confirmed; enrollment endpoint-signed; server authorization explicitly absent                              |
| Add device                 | `candidate_keys_generated` → `sas_verified` → `endpoint_enrollment_signed` → `epoch_key_boxed` → `signed_log_committed`                                                                                                                                                                                                    | Existing endpoint verifies a bound SAS transcript, signs enrollment against a prior head, and records recipient-bound epoch boxing; server cannot enroll                  |
| Add first broker           | `candidate_keys_generated` → `sas_verified` → `broker_enrollment_signed` → `epoch_key_boxed` → `broker_uniqueness_verified` → `signed_log_committed`                                                                                                                                                                       | Signed role binds `broker` and `unattended=true`; starts with zero active brokers and finishes with exactly one active broker                                             |
| Remove device              | `removal_signed` → `rotation_started` → `live_deks_rewrapped` → `remaining_endpoints_acknowledged` → `old_epoch_destroyed` → `signed_log_committed`                                                                                                                                                                        | Signed removal names a different enrolled endpoint, immediately prunes its authority, then forces rewrap, acknowledgement, and old-key destruction                        |
| Rotate epoch               | `rotation_started` → `live_deks_rewrapped` → `remaining_endpoints_acknowledged` → `old_epoch_destroyed` → `signed_log_committed`                                                                                                                                                                                           | All live objects and remaining endpoints are covered before destruction and commit                                                                                        |
| Recovery                   | `recovery_secret_unsealed` → `candidate_keys_generated` → `endpoint_enrollment_signed` → `prior_endpoints_removed` → `rotation_started` → `live_deks_rewrapped` → `remaining_endpoints_acknowledged` → `old_epoch_destroyed` → `recovery_secret_replaced` → `signed_log_committed`                                         | Snapshot removal prunes every pre-recovery endpoint except the recovery initiator and newly enrolled endpoint; forced rotation and a new single-use secret follow         |
| Broker replacement         | `candidate_keys_generated` → `sas_verified` → `broker_enrollment_signed` → `epoch_key_boxed` → `outstanding_jobs_resolved` → `old_broker_removal_signed` → `rotation_started` → `live_deks_rewrapped` → `remaining_endpoints_acknowledged` → `old_epoch_destroyed` → `broker_uniqueness_verified` → `signed_log_committed` | Candidate is enrolled with broker role; signed removal names and prunes the old broker before rotation; exactly one broker remains active                                 |
| Issue grant                | `control_log_head_verified` → `grant_scope_verified` → `grant_signed` → `signed_log_committed`                                                                                                                                                                                                                             | Verified head equals the frozen expected sequence/reference and is at most 900 seconds old; resources are scoped; enrolled issuer endpoint signs                          |
| Revoke grant               | `control_log_head_verified` → `revocation_signed` → `signed_log_committed`                                                                                                                                                                                                                                                 | Verified head equals the expected head; enrolled endpoint signs revocation                                                                                                |
| Direct external disclosure | `control_log_head_verified` → `disclosure_grant_verified` → `broker_provider_direct_connected` → `scoped_plaintext_released` → `plaintext_destroyed` → `disclosure_event_signed` → `signed_log_committed`                                                                                                                  | Every step is executed by the enrolled broker; disclosure event and final commit use broker-signature evidence, never an endpoint-signature flag                          |
| Vault deletion             | `deletion_confirmed` → `tombstone_signed` → `live_dek_wraps_destroyed` → `hosted_ciphertext_delete_requested` → `rotation_started` → `old_epoch_destroyed` → `signed_log_committed`                                                                                                                                        | User confirms; tombstone is signed; referenced live-wrap set is destroyed; hosted ciphertext deletion is requested; forced terminal rotation destroys the bound old epoch |

## Alert and incomplete outcomes

These outcomes must remain visible until resumed or signed-aborted:

- SAS mismatch, stale log head, missing endpoint signature, or an out-of-order
  transition.
- A server attempt to initiate, enroll, or complete a ceremony.
- Any server-originated alert acknowledgement or recovery actor outside recovery.
- Cross-ceremony, cross-vault, cross-epoch, non-monotonic, or forged-prefix
  transcript input.
- Expected-head mismatch, unknown signer, candidate self-enrollment, or a
  presence-only reference that differs from the value frozen at start.
- Unsigned or wrong-head pause/acknowledgement/resume; endpoint/broker role
  substitution; generated-ID aliasing; or a removed signer attempting commit.
- Rotation with any live DEK not rewrapped, remaining endpoint not acknowledged,
  or old epoch key not destroyed.
- Recovery without immediate recovery-secret replacement.
- Broker replacement with unresolved jobs or a signed-state active-broker count
  other than one.
- Disclosure through a hosted relay, fallback path, unscoped grant, or retained
  plaintext. Once plaintext is released, pause and abort fail closed until the
  destruction step succeeds.
- Vault deletion without user confirmation, tombstone, hosted deletion request,
  or old-key destruction.

## Independent transcript review against the M3 design

**Independent result: UNCONDITIONAL GO.** After five adversarial passes, the
independent Fable review found no executable release blocker in the submitted
reducer, state invariants, transcripts, or adversarial tests. The final recovery
repair is enforced at three layers: the reducer atomically prunes the complete
pre-recovery endpoint set, replay validation rejects any forbidden survivor, and
tests prove every pruned endpoint is denied both lifecycle transitions and final
commit. The focused Core E2EE suite passes 96 tests across 10 files, including
native/WASM parity. The ceremony contract covers every ceremony named by the M3
design and makes the design’s implicit failure states explicit. The following
interpretations are normative for implementation:

1. **Recovery endpoint set.** “Remove old endpoints” means the signed snapshot
   of endpoints that existed before recovery began. It excludes the newly
   enrolled recovery endpoint. Without that definition, a literal implementation
   could remove the device it just created.
2. **Broker uniqueness.** The active count is derived from signed control state,
   never trusted from a hosted directory. A first broker can move from zero to
   one. During replacement, the candidate remains pending while the old broker
   owns the active lease; the switch finishes with exactly one active broker.
   There is never a committed state with two active brokers.
3. **Forced rotation completion.** “Immediately” is operational intent, not an
   atomic guarantee. Device removal, recovery, broker replacement, and deletion
   remain incomplete or alert until rewrap, acknowledgement, old-key destruction,
   and signed-log commit finish. Access should stay fail-closed during that gap.
4. **Deletion rotation.** Vault deletion still needs an explicit terminal key
   destruction transition even though no ordinary next epoch will be used. The
   hosted delete request is not cryptographic deletion by itself.
5. **Abort durability.** The design requires signed append-only endpoint state;
   this contract applies that requirement to abort as well as success, but uses
   a distinct `abortLogged` marker. It never sets the success commit flag and it
   preserves both abort and alert reasons.
6. **Revocation boundary.** Revocation prevents future plaintext release after a
   fresh control-head check. It cannot recall bytes already accepted by an
   external provider. Disclosure UX and policy must not imply retroactive erasure.
7. **Direct disclosure.** “Direct” means broker-to-provider TLS with no Agent
   Native hosted plaintext hop. Provider trust remains an intentional disclosure
   boundary, not part of the E2EE storage claim.
8. **Evidence granularity.** The TypeScript contract records verified outcomes
   and their binding references, not cryptographic proof bytes. Events bind
   ceremony, vault, epoch, actor, and time; signed, SAS, recovery-unseal,
   epoch-box, prior-snapshot, live-wrap, and destroyed-epoch seams carry the
   references needed by the later verifier.
9. **Epoch transition point.** `rotation_started` binds `rotationTargetEpoch` to
   current epoch plus one. State continues to report the old active epoch until
   `old_epoch_destroyed` proves destruction of that exact epoch; only then does
   the state epoch increment. This prevents consumers from treating the new
   epoch as active before the old-key retirement gate finishes.
   Ordinary rotation checkpoints live in the separate local
   `rotation-preparation` namespace, never as unofficial generations in the
   official custody repository. Its secret-bearing 512-byte record is kept only
   in OS-protected Keychain/secure storage, never as an ordinary disk file.
   Phases `PREPARED`, `REWRAPPED`, and
   `ACKNOWLEDGED` retain pending N+1 without an expected edge.
   `AWAITING_CONTROL_COMMIT` freezes the exact next sequence, previous head,
   membership transcript, artifact lengths, and full encrypted-spool digest.
   The spool's canonical plaintext frame is encrypted at rest under a key
   derived from pending N+1, vault, and ceremony.

   Completion order is authority stage, official custody CAS that destroys old
   N and installs N+1, authority promotion plus exact official reread, and only
   then preparation `CONSUMED`. In `CONSUMED`, the pending slot is zero, while
   public bindings and the encrypted spool remain until hosted append/ack is
   durably confirmed; crash recovery retries with official active N+1. Before
   deletion, the client authenticates the canonical receipt's vault, entry ID,
   sequence, head, recovery-wrap hash, and byte length against the retained
   spool and official authority, then durably stores those exact receipt bytes
   in OS-protected Keychain. Only after that receipt fence does the client delete
   the spool, fsync its containing directory, and CAS `CLEANED`, which
   clears key, edge, and artifact fields. The preparation record is retained,
   and only `CLEANED` may CAS to a next-generation `PREPARED` ceremony. Missing
   spool plus missing or different receipt is rollback, not crash recovery.

10. **Authorization and reference equality.** The expected control head and
    role-tagged enrolled signer set are frozen in start/state. Signed and
    control-head steps
    must match the expected head exactly. Candidate identity, SAS transcript,
    epoch-box recipient, pre-recovery snapshot, and live-wrap set are persisted
    and equality-checked across their steps.
11. **Broker signature semantics.** `disclosure_event_signed` and the broker's
    final disclosure commit use `brokerSignatureVerified`; endpoint signatures
    retain `endpointSignatureVerified`. The contract no longer calls one key type
    by the other's name.
12. **Plaintext cleanup escape hatch.** `plaintext_destroyed` is the sole
    completion allowed while a disclosure is alert or incomplete. It clears the
    outstanding-plaintext interlock without clearing or acknowledging the alert,
    after which signed abort is possible.
13. **Lifecycle authority.** Pause, alert acknowledgement, and resume use the
    same enrolled endpoint, signer/actor equality, and expected-head checks as
    signed abort. Relay-authored lifecycle events cannot reactivate a ceremony.
14. **Removal authority.** Ordinary device and broker removal evidence identifies
    one currently enrolled signer different from the author. Recovery snapshot
    removal is deliberately set-based instead: it records and prunes every
    endpoint-role signer except the recovery initiator and newly generated,
    enrolled endpoint. State validation requires post-snapshot endpoint authority
    to be a subset of those two survivors. No pre-recovery endpoint can perform a
    later lifecycle transition or finalize the recovery transcript.
15. **Role and identity separation.** Signer membership is role-tagged.
    Endpoint-signed steps require endpoint role, broker disclosure signatures
    and actors require broker role, and generated candidate IDs cannot alias any
    enrolled identity across either role.

The remediation tests fail closed for the original nine review findings and the
four later authority findings: critical
snapshot/wrap evidence, server alert origin, abort/commit separation, event and
signed-seam binding, outstanding plaintext, timestamp order, recovery authority,
forged state sequences, epoch-box/recovery-unseal evidence, signed lifecycle
authority, immediate signer pruning, endpoint/broker role separation, and
candidate identity collision. The final set-removal regression additionally
proves every pre-recovery endpoint loses authority. No ceremony can
reach `committed` without the signed-log step, and no removal, recovery, broker
replacement, or deletion transcript can report success before required old-key
destruction. Cryptographic primitive selection and proof verification remain
outside this M3 state-machine slice.

The contract intentionally leaves proof authenticity and derivation to the
cryptographic implementation: it carries equality-bound IDs, heads, generations,
and verification outcomes, but does not verify signature bytes, SAS computation,
key destruction, or secure storage itself. Production must construct state by
replaying authenticated start/event records (or an equivalently authenticated
snapshot); accepting caller-invented start state would make every frozen
reference self-attested and is outside this pure reducer's trust boundary.

The independent review accepted those boundaries as hard requirements for the
runtime milestone, not defects in this pure contract. It also leaves endpoint
compromise, metadata exposure, availability, actual out-of-band SAS comparison,
and post-compromise broker replacement policy outside the ceremony reducer's
guarantees. None may be represented as solved merely because M3 is closed.
