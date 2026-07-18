#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-enrollment-offer-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT
ARCHITECTURES="${PRIVATE_VAULT_BUILD_ARCHITECTURES:-universal}"
if [[ "$ARCHITECTURES" != "universal" && "$ARCHITECTURES" != "arm64" ]]; then
  echo "Enrollment offer test architectures must be universal or arm64" >&2
  exit 1
fi

PRIVATE_VAULT_BUILD_ARCHITECTURES="$ARCHITECTURES" \
PRIVATE_VAULT_BUILD_ENROLLMENT_OFFER_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.enrollment-offer-tests/private-vault-enrollment-offer-tests-arm64"
if [[ "$ARCHITECTURES" == "universal" ]]; then
  arch -x86_64 "$OUTPUT/.enrollment-offer-tests/private-vault-enrollment-offer-tests-x86_64"
fi
