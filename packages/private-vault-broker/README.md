# @agent-native/private-vault-broker

Headless runtime primitives for an Agent Native personal-vault broker. The
package provides a native `anc/v1` cryptography implementation, injected key
custody and encrypted-state interfaces, a fail-closed lock lifecycle, and a
signed byte-exact transport for the five hosted opaque-job routes. Encrypted
results use a bounded frame whose only clear metadata is version, opaque job
ID, terminal state, and ciphertext length.

Its reusable native-service contract exposes only semantic vault operations:
enrollment and recovery, lock lifecycle, content-object sealing/opening,
hosted-job processing, and exact `anc/v1` endpoint-request signing for `POST`
on only the five exported broker-job routes. Every byte
buffer is bounded and copied at the trusted main-process boundary. The surface
has no generic cryptography operation, raw key method, filesystem path, provider
field, or extensible metadata bag; health is content-free and carries no vault
identity. Health explicitly reports when the native service is unavailable.
Vault removal additionally requires a canonical signed removal-and-rotation
control-log entry; implementations must verify it against the authenticated
current control head and prove it removes this local endpoint or broker before
deleting custody material. Endpoint-request signing likewise requires the
proof's vault and endpoint identities to equal the currently unlocked local
broker identity; callers cannot supply a separate identity override.

This package does not provide an Electron bridge, hosted route handlers,
app-specific actions, or a persistence implementation. Those integrations
supply the narrow adapters exported here, keeping plaintext keys out of hosted
application code.

`PrivateVaultBrokerWorker` is the reusable encrypted-job loop. It claims only
content-free coordinates, retrieves and authenticates one encrypted request,
opens it through the semantic native-service boundary, acknowledges the exact
attempt, runs an injected local action executor, seals the result natively, and
submits the encrypted result. Failed work moves to a bounded retry schedule;
it never falls back to hosted plaintext execution.
