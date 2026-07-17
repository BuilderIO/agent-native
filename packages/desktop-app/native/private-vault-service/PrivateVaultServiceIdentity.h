#ifndef AGENT_NATIVE_PRIVATE_VAULT_SERVICE_IDENTITY_H
#define AGENT_NATIVE_PRIVATE_VAULT_SERVICE_IDENTITY_H

#define PV_SERVICE_IDENTIFIER "com.agentnative.desktop.private-vault-service"
#define PV_CLIENT_IDENTIFIER "com.agentnative.desktop"
#define PV_TEAM_IDENTIFIER "W3PMF2T3MW"
#define PV_KEYCHAIN_ACCESS_GROUP \
    "W3PMF2T3MW.com.agentnative.desktop.private-vault"
#define PV_CLIENT_REQUIREMENT                                                \
    "identifier \"com.agentnative.desktop\" and anchor apple generic and " \
    "certificate leaf[subject.OU] = \"W3PMF2T3MW\""

#endif
