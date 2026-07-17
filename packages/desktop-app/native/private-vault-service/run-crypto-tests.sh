#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_ROOT="$ROOT/native/private-vault-service"
BUILD_SCRIPT="$ROOT/native/build-private-vault-service.sh"
mkdir -p "$SERVICE_ROOT/.build"
TEST_ROOT="$(mktemp -d "$SERVICE_ROOT/.build/crypto-tests.XXXXXX")"
TEST_BUILD="$TEST_ROOT/service/.crypto-tests"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

# Build the service first so tests exercise the same pinned, thin archives and
# the service-link check proves there is no runtime libsodium dependency.
PRIVATE_VAULT_BUILD_CRYPTO_TESTS=1 \
  bash "$BUILD_SCRIPT" "$TEST_ROOT/service" >/dev/null

HOST_ARCH="$(uname -m)"
"$TEST_BUILD/private-vault-crypto-tests-$HOST_ARCH"

OTHER_ARCH=arm64
[[ "$HOST_ARCH" == arm64 ]] && OTHER_ARCH=x86_64
if arch -"$OTHER_ARCH" /usr/bin/true >/dev/null 2>&1; then
  arch -"$OTHER_ARCH" "$TEST_BUILD/private-vault-crypto-tests-$OTHER_ARCH"
else
  printf 'Skipped %s vector execution: compatible translation is unavailable\n' \
    "$OTHER_ARCH" >&2
fi

SERVICE_EXECUTABLE="$TEST_ROOT/service/com.agentnative.desktop.private-vault-service.xpc/Contents/MacOS/AgentNativePrivateVaultService"
SERVICE_NOTICES="$TEST_ROOT/service/com.agentnative.desktop.private-vault-service.xpc/Contents/Resources/THIRD_PARTY_NOTICES.md"
cmp "$ROOT/build/THIRD_PARTY_NOTICES.md" "$SERVICE_NOTICES"
if otool -L "$SERVICE_EXECUTABLE" | grep -i libsodium; then
  echo "Private Vault service unexpectedly links a libsodium dynamic library" >&2
  exit 1
fi

printf 'Private Vault native crypto architecture checks passed\n'
