#ifndef AGENT_NATIVE_PRIVATE_VAULT_HOSTED_ORIGIN_H
#define AGENT_NATIVE_PRIVATE_VAULT_HOSTED_ORIGIN_H

/* Release builds may override this at compile time with another reviewed exact
 * HTTPS origin. It is never read from Electron, user defaults, or process env.
 */
#ifndef ANC_PRIVATE_VAULT_HOSTED_ORIGIN
#define ANC_PRIVATE_VAULT_HOSTED_ORIGIN "https://content.agent-native.com"
#endif

#endif
