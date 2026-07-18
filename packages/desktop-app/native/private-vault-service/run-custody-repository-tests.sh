#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-repository-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT
ARCHITECTURES="${PRIVATE_VAULT_BUILD_ARCHITECTURES:-universal}"
if [[ "$ARCHITECTURES" != "universal" && "$ARCHITECTURES" != "arm64" ]]; then
  echo "Custody repository test architectures must be universal or arm64" >&2
  exit 1
fi

bash "$ROOT/native/private-vault-service/guard-custody-pageable-record.sh"

PRIVATE_VAULT_BUILD_ARCHITECTURES="$ARCHITECTURES" \
PRIVATE_VAULT_BUILD_REPOSITORY_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null

ARM64="$OUTPUT/.repository-tests/private-vault-repository-tests-arm64"
X86_64="$OUTPUT/.repository-tests/private-vault-repository-tests-x86_64"
lipo "$ARM64" -verify_arch arm64
"$ARM64"
if [[ "$ARCHITECTURES" == "universal" ]]; then
  lipo "$X86_64" -verify_arch x86_64
  arch -x86_64 "$X86_64"
fi
