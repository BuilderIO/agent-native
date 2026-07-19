#ifndef AGENT_NATIVE_PRIVATE_VAULT_TRUSTED_GENESIS_UI_H
#define AGENT_NATIVE_PRIVATE_VAULT_TRUSTED_GENESIS_UI_H

#include <cstdint>
#include <vector>

bool PVTrustedGenesisCollectFullPhrase(
    const std::vector<uint8_t> &recoveryPhrase,
    std::vector<uint8_t> &confirmedPhrase);

bool PVTrustedGenesisConfirmAdmission(const char *accountID,
                                      const char *workspaceID);

bool PVTrustedRecoveryCollectPhrase(const char *vaultID,
                                    std::vector<uint8_t> &recoveryPhrase);

bool PVTrustedExportCollectPhrase(const char *vaultID,
                                  std::vector<uint8_t> &recoveryPhrase);

#endif
