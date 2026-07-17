# @agent-native/private-vault-broker

Headless runtime primitives for an Agent Native personal-vault broker. The
package provides a native `anc/v1` cryptography implementation, injected key
custody and encrypted-state interfaces, a fail-closed lock lifecycle, and a
signed byte-exact transport for the five hosted opaque-job routes. Encrypted
results use a bounded frame whose only clear metadata is version, opaque job
ID, terminal state, and ciphertext length.

This package does not provide an Electron bridge, hosted route handlers,
app-specific actions, or a persistence implementation. Those integrations
supply the narrow adapters exported here, keeping plaintext keys out of hosted
application code.
