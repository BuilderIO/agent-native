#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$ROOT/native/private-vault-service"
SOURCES=(
  "$SOURCE_ROOT/main.m"
  "$SOURCE_ROOT/Protocol.m"
  "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c"
  "$SOURCE_ROOT/storage/PrivateVaultKeychain.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m"
  "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m"
  "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m"
  "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m"
)
INFO_PLIST="$SOURCE_ROOT/Info.plist"
ENTITLEMENTS="$ROOT/build/entitlements.private-vault-service.plist"
OUTPUT_ROOT="${1:-$SOURCE_ROOT/build}"
BUNDLE="$OUTPUT_ROOT/com.agentnative.desktop.private-vault-service.xpc"
CONTENTS="$BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
EXECUTABLE="$MACOS/AgentNativePrivateVaultService"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
INTERMEDIATES="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-service.XXXXXX")"
VENDOR_SOURCE="$(bash "$ROOT/native/fetch-private-vault-deps.sh")"
THIRD_PARTY_NOTICES="$ROOT/build/THIRD_PARTY_NOTICES.md"

cleanup() {
  rm -rf "$VENDOR_SOURCE"
  rm -rf "$INTERMEDIATES"
}
trap cleanup EXIT

plutil -lint "$INFO_PLIST" >/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")" == \
  "com.agentnative.desktop.private-vault-service" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundlePackageType' "$INFO_PLIST")" == "XPC!" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$INFO_PLIST")" == "13.0" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :keychain-access-groups:0' "$ENTITLEMENTS")" == \
  "W3PMF2T3MW.com.agentnative.desktop.private-vault" ]]

build_libsodium_slice() {
  local architecture="$1"
  local host="$2"
  local slice_root="$INTERMEDIATES/libsodium-$architecture"
  local archive="$slice_root/lib/libsodium.a"
  mkdir -p "$slice_root/build"
  (
    cd "$slice_root/build"
    CC="$(xcrun -f clang)" \
    CFLAGS="-O2 -arch $architecture -mmacosx-version-min=13.0" \
    CPPFLAGS="-isysroot $SDK" \
    LDFLAGS="-arch $architecture -isysroot $SDK -mmacosx-version-min=13.0" \
      "$VENDOR_SOURCE/configure" \
        --host="$host" \
        --prefix="$slice_root" \
        --disable-shared \
        --enable-static \
        --disable-dependency-tracking \
        >/dev/null
    make -j"$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)" >/dev/null
    make install >/dev/null
  )
  [[ -f "$archive" ]]
  lipo "$archive" -verify_arch "$architecture"
  printf '%s\n' "$slice_root"
}

ARM64_SODIUM="$(build_libsodium_slice arm64 aarch64-apple-darwin)"
X86_64_SODIUM="$(build_libsodium_slice x86_64 x86_64-apple-darwin)"

mkdir -p "$(dirname "$THIRD_PARTY_NOTICES")"
{
  printf '# Third-party notices\n\n'
  cat "$SOURCE_ROOT/third-party/libsodium/NOTICE.md"
  printf '\n## License text\n\n```text\n'
  cat "$SOURCE_ROOT/third-party/libsodium/LICENSE"
  printf '```\n'
} > "$THIRD_PARTY_NOTICES"

compile_slice() {
  local architecture="$1"
  local output="$2"
  local sodium_root="$3"
  xcrun clang -O2 -fobjc-arc -fblocks -Wall -Wextra -Werror \
    -isysroot "$SDK" \
    -mmacosx-version-min=13.0 \
    -arch "$architecture" \
    -I"$SOURCE_ROOT/crypto" \
    -I"$SOURCE_ROOT/storage" \
    -I"$sodium_root/include" \
    -framework Foundation \
    -framework Security \
    -framework LocalAuthentication \
    "${SOURCES[@]}" \
    "$sodium_root/lib/libsodium.a" \
    -o "$output"
}

compile_slice arm64 "$INTERMEDIATES/service-arm64" "$ARM64_SODIUM"
compile_slice x86_64 "$INTERMEDIATES/service-x86_64" "$X86_64_SODIUM"

case "${PRIVATE_VAULT_BUILD_CRYPTO_TESTS:-}" in
  "") ;;
  1)
  CRYPTO_TEST_OUTPUT="$OUTPUT_ROOT/.crypto-tests"
  rm -rf "$CRYPTO_TEST_OUTPUT"
  mkdir -p "$CRYPTO_TEST_OUTPUT"
  compile_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$CRYPTO_TEST_OUTPUT/private-vault-crypto-tests-$architecture"
    xcrun clang -O2 -Wall -Wextra -Werror \
      -isysroot "$SDK" \
      -mmacosx-version-min=13.0 \
      -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" \
      -I"$sodium_root/include" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/crypto/PrivateVaultCryptoTests.c" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_test_slice arm64 "$ARM64_SODIUM"
  compile_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *)
    echo "Invalid Private Vault crypto-test build mode" >&2
    exit 1
    ;;
esac

case "${PRIVATE_VAULT_BUILD_CUSTODY_TESTS:-}" in
  "") ;;
  1)
  CUSTODY_TEST_OUTPUT="$OUTPUT_ROOT/.custody-tests"
  rm -rf "$CUSTODY_TEST_OUTPUT"
  mkdir -p "$CUSTODY_TEST_OUTPUT"
  compile_custody_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$CUSTODY_TEST_OUTPUT/private-vault-custody-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" \
      -mmacosx-version-min=13.0 \
      -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" \
      -I"$SOURCE_ROOT/storage" \
      -I"$sodium_root/include" \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecordTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_custody_test_slice arm64 "$ARM64_SODIUM"
  compile_custody_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *)
    echo "Invalid Private Vault custody-test build mode" >&2
    exit 1
    ;;
esac

case "${PRIVATE_VAULT_BUILD_FENCE_TESTS:-}" in
  "") ;;
  1)
  FENCE_TEST_OUTPUT="$OUTPUT_ROOT/.fence-tests"
  rm -rf "$FENCE_TEST_OUTPUT"
  mkdir -p "$FENCE_TEST_OUTPUT"
  compile_fence_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$FENCE_TEST_OUTPUT/private-vault-fence-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" \
      -mmacosx-version-min=13.0 \
      -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" \
      -I"$SOURCE_ROOT/storage" \
      -I"$sodium_root/include" \
      -framework Foundation \
      -framework Security \
      -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFenceTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_fence_test_slice arm64 "$ARM64_SODIUM"
  compile_fence_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *)
    echo "Invalid Private Vault fence-test build mode" >&2
    exit 1
    ;;
esac

case "${PRIVATE_VAULT_BUILD_REPOSITORY_TESTS:-}" in
  "") ;;
  1)
  REPOSITORY_TEST_OUTPUT="$OUTPUT_ROOT/.repository-tests"
  rm -rf "$REPOSITORY_TEST_OUTPUT"
  mkdir -p "$REPOSITORY_TEST_OUTPUT"
  compile_repository_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$REPOSITORY_TEST_OUTPUT/private-vault-repository-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -DANC_PRIVATE_VAULT_TESTING=1 \
      -isysroot "$SDK" \
      -mmacosx-version-min=13.0 \
      -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" \
      -I"$SOURCE_ROOT/storage" \
      -I"$sodium_root/include" \
      -framework Foundation \
      -framework Security \
      -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepositoryTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_repository_test_slice arm64 "$ARM64_SODIUM"
  compile_repository_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *)
    echo "Invalid Private Vault repository-test build mode" >&2
    exit 1
    ;;
esac

rm -rf "$BUNDLE"
mkdir -p "$MACOS" "$RESOURCES"
cp "$INFO_PLIST" "$CONTENTS/Info.plist"
cp "$THIRD_PARTY_NOTICES" "$RESOURCES/THIRD_PARTY_NOTICES.md"
lipo -create \
  "$INTERMEDIATES/service-arm64" \
  "$INTERMEDIATES/service-x86_64" \
  -output "$EXECUTABLE"
chmod 0755 "$EXECUTABLE"

plutil -lint "$CONTENTS/Info.plist" >/dev/null
lipo "$EXECUTABLE" -verify_arch arm64 x86_64
if otool -L "$EXECUTABLE" | grep -i 'libsodium'; then
  echo "Private Vault service unexpectedly links a libsodium dynamic library" >&2
  exit 1
fi
printf '%s\n' "$BUNDLE"
