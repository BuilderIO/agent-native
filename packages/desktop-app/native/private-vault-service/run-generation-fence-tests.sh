#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_ROOT="$ROOT/native/private-vault-service"
BUILD_SCRIPT="$ROOT/native/build-private-vault-service.sh"
mkdir -p "$SERVICE_ROOT/.build"
TEST_ROOT="$(mktemp -d "$SERVICE_ROOT/.build/fence-tests.XXXXXX")"
TEST_BUILD="$TEST_ROOT/service/.fence-tests"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

# The normal service build proves the storage sources and
# LocalAuthentication/Security linkage in both production slices. Test binaries
# reuse the same verified, pinned static libsodium archives.
PRIVATE_VAULT_BUILD_FENCE_TESTS=1 \
  bash "$BUILD_SCRIPT" "$TEST_ROOT/service" >/dev/null

HOST_ARCH="$(uname -m)"
"$TEST_BUILD/private-vault-fence-tests-$HOST_ARCH"

OTHER_ARCH=arm64
[[ "$HOST_ARCH" == arm64 ]] && OTHER_ARCH=x86_64
if arch -"$OTHER_ARCH" /usr/bin/true >/dev/null 2>&1; then
  arch -"$OTHER_ARCH" "$TEST_BUILD/private-vault-fence-tests-$OTHER_ARCH"
else
  printf 'Skipped %s fence execution: compatible translation is unavailable\n' \
    "$OTHER_ARCH" >&2
fi

SERVICE_EXECUTABLE="$TEST_ROOT/service/com.agentnative.desktop.private-vault-service.xpc/Contents/MacOS/AgentNativePrivateVaultService"
lipo "$SERVICE_EXECUTABLE" -verify_arch arm64 x86_64
if otool -L "$SERVICE_EXECUTABLE" | grep -i libsodium; then
  echo "Private Vault service unexpectedly links a libsodium dynamic library" >&2
  exit 1
fi

printf 'Private Vault generation-fence architecture checks passed\n'
