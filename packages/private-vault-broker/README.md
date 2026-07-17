# @agent-native/private-vault-broker

Headless runtime primitives for an Agent Native personal-vault broker. The
package provides a native `anc/v1` cryptography implementation, injected key
custody and encrypted-state interfaces, and a fail-closed lock lifecycle.

This package does not provide an Electron bridge, hosted relay, app-specific
actions, or a persistence implementation. Those integrations supply the narrow
adapters exported here, keeping plaintext keys out of hosted application code.
