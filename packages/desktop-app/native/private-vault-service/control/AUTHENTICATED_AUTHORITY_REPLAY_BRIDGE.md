# Authenticated authority replay bridge

This internal bridge is the only native path from a persisted authenticated
authority checkpoint through signed control-log replay to a commit-capable
`AncPrivateVaultVerifiedReplayResult`.

Grant-revocation replay uses the same authenticated boundary. The native
control-log reducer supplies the verifier with immutable copies of the exact
signed entry, exact inner envelope, exact embedded signed `grant-revoke`
envelope, and authenticated prior state. The verifier must durably apply the
revocation to native encrypted authority storage before returning success;
returning success after only inspecting hosted state is not authorization.

The bridge freezes and validates the checkpoint before replay, requires the
control-log implementation's exact private authenticated-result type, verifies
that the captured prior state exactly matches the checkpoint, and accepts only
a non-idempotent prepared-epoch promotion at the next custody generation and
epoch. The next authority snapshot must survive canonical encode/decode and
preserve the verified vault, sequence, head, membership, member, tombstone,
recovery, signed-time, and freshness state. Idempotent replay is intentionally
not commit-capable; a coordinator must use its official reread path instead.

The public headers expose no constructors for authenticated replay or verified
commit results. The internal C bridge records every legitimately minted object
in bounded, lock-protected, weak-keyed process-private registries. Registry
evidence contains canonical frozen copies of the prior, next, checkpoint, and
entry-hash facts. Authority mint and commit require that evidence, compare the
presentation object against it, reconstruct fresh snapshots from it, and
re-check sequence, head, membership, recovery, epoch, custody generation, and
monotonic verification time. Runtime construction of an exact private class,
copying its ivars, or invoking a discovered setter therefore cannot create a
commit capability. Evidence is not consumed until commit, so a storage retry
does not require replaying the signed entry.

Every presentation object minted by this bridge also rejects KVC, typed setter,
selector, and `NSInvocation` mutation after construction. Those guards are
defense in depth; class identity and runtime-visible method names are not
authentication.

This is a same-process API boundary, not a defense against arbitrary native
memory reads/writes, method swizzling, injected code, or patching the registry
implementation. Code with those powers is already executing inside the signed
Desktop native trusted computing base and can subvert the service more directly.

Run the focused arm64 and Rosetta corpus with:

```sh
packages/desktop-app/native/private-vault-service/run-authenticated-replay-bridge-tests.sh
```
