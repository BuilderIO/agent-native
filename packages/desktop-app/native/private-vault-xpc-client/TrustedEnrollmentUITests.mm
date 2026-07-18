#include "TrustedEnrollmentUI.h"

#include <cassert>
#include <cstring>

int main() {
  uint8_t hash[32];
  memset(hash, 0x42, sizeof hash);
  assert(PVTrustedEnrollmentValidateInput(
      "056-775-976", "03030303030303030303030303030303", "broker", true,
      hash, sizeof hash));
  assert(PVTrustedEnrollmentValidateInput(
      "056-775-976", "03030303030303030303030303030303", "endpoint", false,
      hash, sizeof hash));
  assert(!PVTrustedEnrollmentValidateInput(
      "056775976", "03030303030303030303030303030303", "broker", true, hash,
      sizeof hash));
  assert(!PVTrustedEnrollmentValidateInput(
      "056-775-976", "0303030303030303030303030303030G", "broker", true,
      hash, sizeof hash));
  assert(!PVTrustedEnrollmentValidateInput(
      "056-775-976", "03030303030303030303030303030303", "broker", false,
      hash, sizeof hash));
  memset(hash, 0, sizeof hash);
  assert(!PVTrustedEnrollmentValidateInput(
      "056-775-976", "03030303030303030303030303030303", "broker", true,
      hash, sizeof hash));
  return 0;
}
