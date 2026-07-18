#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
BUILD_ROOT="${1:-$(dirname "$0")/build}"
ARCHITECTURE="${PRIVATE_VAULT_RECOVERY_TEST_ARCH:-arm64}"
TEST_BINARY="$BUILD_ROOT/.recovery-tests/private-vault-recovery-tests-$ARCHITECTURE"

[[ "$ARCHITECTURE" == "arm64" || "$ARCHITECTURE" == "x86_64" ]] || {
  echo "Invalid recovery test architecture" >&2
  exit 1
}
[[ -x "$TEST_BINARY" ]] || {
  echo "Build recovery tests first with PRIVATE_VAULT_BUILD_RECOVERY_TESTS=1" >&2
  exit 1
}

pnpm --dir "$ROOT/packages/core" exec tsx \
  scripts/materialize-native-recovery-derivation-oracle.ts | \
  arch -"$ARCHITECTURE" "$TEST_BINARY"
