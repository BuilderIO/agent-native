#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-authority-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT
ARCHITECTURES="${PRIVATE_VAULT_BUILD_ARCHITECTURES:-universal}"
if [[ "$ARCHITECTURES" != "universal" && "$ARCHITECTURES" != "arm64" ]]; then
  echo "Authority test architectures must be universal or arm64" >&2
  exit 1
fi

PRIVATE_VAULT_BUILD_ARCHITECTURES="$ARCHITECTURES" \
PRIVATE_VAULT_BUILD_AUTHORITY_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.authority-tests/private-vault-authority-tests-arm64"
if [[ "$ARCHITECTURES" == "universal" ]]; then
  arch -x86_64 "$OUTPUT/.authority-tests/private-vault-authority-tests-x86_64"
fi
