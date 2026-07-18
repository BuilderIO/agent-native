#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-enrollment-sas-receipt-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT
ARCHITECTURES="${PRIVATE_VAULT_BUILD_ARCHITECTURES:-universal}"
if [[ "$ARCHITECTURES" != "universal" && "$ARCHITECTURES" != "arm64" ]]; then
  echo "Enrollment SAS receipt tests require universal or arm64" >&2
  exit 1
fi

PRIVATE_VAULT_BUILD_ARCHITECTURES="$ARCHITECTURES" \
PRIVATE_VAULT_BUILD_ENROLLMENT_SAS_RECEIPT_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.enrollment-sas-receipt-tests/private-vault-enrollment-sas-receipt-tests-arm64"
if [[ "$ARCHITECTURES" == "universal" ]]; then
  arch -x86_64 "$OUTPUT/.enrollment-sas-receipt-tests/private-vault-enrollment-sas-receipt-tests-x86_64"
fi
