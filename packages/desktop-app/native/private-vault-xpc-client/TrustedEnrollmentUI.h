#ifndef AGENT_NATIVE_PRIVATE_VAULT_TRUSTED_ENROLLMENT_UI_H
#define AGENT_NATIVE_PRIVATE_VAULT_TRUSTED_ENROLLMENT_UI_H

#include <cstddef>
#include <cstdint>

enum class PVTrustedEnrollmentDecision {
  Cancelled = 0,
  Confirmed = 1,
  Mismatch = 2,
};

/* Runs only on the signed addon's main thread. The expected code and transcript
 * hash must have come from native challenge verification, never JavaScript. */
PVTrustedEnrollmentDecision PVTrustedEnrollmentConfirmSAS(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength);

/* Shows the authorizer-derived code before the public challenge is returned to
 * Electron. The user must acknowledge that the candidate can compare it; the
 * code itself never crosses the native addon boundary. */
bool PVTrustedEnrollmentPresentSAS(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength);

/* Pure boundary validation shared with the noninteractive native test. */
bool PVTrustedEnrollmentValidateInput(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength);

#endif
