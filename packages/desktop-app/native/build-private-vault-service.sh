#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$ROOT/native/private-vault-service"
SOURCES=(
  "$SOURCE_ROOT/main.m"
  "$SOURCE_ROOT/Protocol.m"
  "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c"
  "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m"
  "$SOURCE_ROOT/control/PrivateVaultControlLog.m"
  "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m"
  "$SOURCE_ROOT/control/PrivateVaultEndpointRequest.m"
  "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m"
  "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m"
  "$SOURCE_ROOT/control/PrivateVaultGenesisBuilder.m"
  "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m"
  "$SOURCE_ROOT/recovery/PrivateVaultMnemonic.m"
  "$SOURCE_ROOT/recovery/PrivateVaultRecoveryAuthority.m"
  "$SOURCE_ROOT/storage/PrivateVaultKeychain.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m"
  "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m"
  "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m"
  "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisArtifactStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisLock.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisCoordinator.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisStartup.m"
  "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m"
  "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m"
  "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationRecord.m"
  "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpool.m"
  "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationRecord.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationArtifactStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultRotationCoordinator.m"
  "$SOURCE_ROOT/storage/PrivateVaultHostedAppendRetryStore.m"
  "$SOURCE_ROOT/storage/PrivateVaultStateRoot.m"
  "$SOURCE_ROOT/transport/PrivateVaultHostedAppendCandidateIndex.m"
  "$SOURCE_ROOT/transport/PrivateVaultHostedAppendRetryCoordinator.m"
  "$SOURCE_ROOT/transport/PrivateVaultHostedAppendTransport.m"
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
PRIVATE_VAULT_HOSTED_ORIGIN="${PRIVATE_VAULT_HOSTED_ORIGIN:-https://content.agent-native.com}"
PRIVATE_VAULT_BUILD_ARCHITECTURES="${PRIVATE_VAULT_BUILD_ARCHITECTURES:-universal}"
if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" != "universal" &&
      "$PRIVATE_VAULT_BUILD_ARCHITECTURES" != "arm64" ]]; then
  echo "Private Vault build architectures must be universal or arm64" >&2
  exit 1
fi
if [[ ! "$PRIVATE_VAULT_HOSTED_ORIGIN" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
  echo "Private Vault hosted origin must be one exact HTTPS origin" >&2
  exit 1
fi
HOSTED_ORIGIN_DEFINE="-DANC_PRIVATE_VAULT_HOSTED_ORIGIN=\"$PRIVATE_VAULT_HOSTED_ORIGIN\""
INTERMEDIATES="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-service.XXXXXX")"
VENDOR_SOURCE=""
VENDOR_FETCH_LOCK="$SOURCE_ROOT/.build/vendor-fetch.lock"
VENDOR_FETCH_LOCK_HELD=0
THIRD_PARTY_NOTICES="$ROOT/build/THIRD_PARTY_NOTICES.md"
NOTICE_REPLACEMENT=""

release_vendor_fetch_lock() {
  [[ "$VENDOR_FETCH_LOCK_HELD" == 1 ]] || return 0
  local owner=""
  owner="$(cat "$VENDOR_FETCH_LOCK" 2>/dev/null || true)"
  # Clear process state before unlinking. If a signal arrives after unlink and
  # a successor acquires the path, cleanup must never remove its lock.
  VENDOR_FETCH_LOCK_HELD=0
  [[ "$owner" == "$$" ]] || return 0
  rm -f "$VENDOR_FETCH_LOCK"
}

cleanup() {
  release_vendor_fetch_lock
  [[ -z "$NOTICE_REPLACEMENT" ]] || rm -f "$NOTICE_REPLACEMENT"
  [[ -z "$VENDOR_SOURCE" ]] || rm -rf "$VENDOR_SOURCE"
  rm -rf "$INTERMEDIATES"
}
trap cleanup EXIT

# Dependency download/cache replacement is shared by otherwise independent
# builds. Serialize only that short fetch/snapshot phase; compilation remains
# fully parallel and every caller receives a private extracted source tree.
mkdir -p "$(dirname "$VENDOR_FETCH_LOCK")" "$INTERMEDIATES/vendor-tmp"
for _attempt in {1..600}; do
  if /usr/bin/shlock -f "$VENDOR_FETCH_LOCK" -p $$; then
    VENDOR_FETCH_LOCK_HELD=1
    break
  fi
  sleep 0.1
done
if [[ "$VENDOR_FETCH_LOCK_HELD" != 1 ]]; then
  echo "Timed out waiting for Private Vault dependency cache lock" >&2
  exit 1
fi
VENDOR_SOURCE="$(TMPDIR="$INTERMEDIATES/vendor-tmp" \
  bash "$ROOT/native/fetch-private-vault-deps.sh")"
release_vendor_fetch_lock

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
X86_64_SODIUM=""
if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
  X86_64_SODIUM="$(build_libsodium_slice x86_64 x86_64-apple-darwin)"
fi

mkdir -p "$(dirname "$THIRD_PARTY_NOTICES")"
NOTICE_CANDIDATE="$INTERMEDIATES/THIRD_PARTY_NOTICES.md"
{
  printf '# Third-party notices\n\n'
  cat "$SOURCE_ROOT/third-party/libsodium/NOTICE.md"
  printf '\n## License text\n\n```text\n'
  cat "$SOURCE_ROOT/third-party/libsodium/LICENSE"
  printf '```\n\n'
  cat "$SOURCE_ROOT/recovery/third-party/bip39/NOTICE.md"
  printf '\n## BIP39 word list license text\n\n```text\n'
  cat "$SOURCE_ROOT/recovery/third-party/bip39/LICENSE"
  printf '```\n'
} > "$NOTICE_CANDIDATE"
if [[ ! -f "$THIRD_PARTY_NOTICES" || -L "$THIRD_PARTY_NOTICES" ]] ||
   ! cmp -s "$NOTICE_CANDIDATE" "$THIRD_PARTY_NOTICES"; then
  NOTICE_REPLACEMENT="$(mktemp "$THIRD_PARTY_NOTICES.tmp.XXXXXX")"
  chmod 0644 "$NOTICE_REPLACEMENT"
  [[ -f "$NOTICE_REPLACEMENT" && ! -L "$NOTICE_REPLACEMENT" ]]
  cp "$NOTICE_CANDIDATE" "$NOTICE_REPLACEMENT"
  [[ -f "$NOTICE_REPLACEMENT" && ! -L "$NOTICE_REPLACEMENT" ]]
  mv "$NOTICE_REPLACEMENT" "$THIRD_PARTY_NOTICES"
  NOTICE_REPLACEMENT=""
fi
[[ -f "$THIRD_PARTY_NOTICES" && ! -L "$THIRD_PARTY_NOTICES" ]]
[[ "$(shasum -a 256 "$SOURCE_ROOT/recovery/third-party/bip39/english.inc" | awk '{print $1}')" == \
  "4dd7af699f430f200ae6511aa12f9ec6513c650bb063fe1662545fa5fbb8432d" ]]

compile_slice() {
  local architecture="$1"
  local output="$2"
  local sodium_root="$3"
  xcrun clang -O2 -fobjc-arc -fblocks -Wall -Wextra -Werror \
    "$HOSTED_ORIGIN_DEFINE" \
    -isysroot "$SDK" \
    -mmacosx-version-min=13.0 \
    -arch "$architecture" \
    -I"$SOURCE_ROOT/crypto" \
    -I"$SOURCE_ROOT/control" \
    -I"$SOURCE_ROOT/storage" \
    -I"$SOURCE_ROOT/recovery" \
    -I"$SOURCE_ROOT/transport" \
    -I"$SOURCE_ROOT" \
    -I"$sodium_root/include" \
    -framework Foundation \
    -framework Security \
    -framework LocalAuthentication \
    "${SOURCES[@]}" \
    "$sodium_root/lib/libsodium.a" \
    -o "$output"
}

compile_slice arm64 "$INTERMEDIATES/service-arm64" "$ARM64_SODIUM"
if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
  compile_slice x86_64 "$INTERMEDIATES/service-x86_64" "$X86_64_SODIUM"
fi

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

case "${PRIVATE_VAULT_BUILD_RECOVERY_TESTS:-}" in
  "") ;;
  1)
  RECOVERY_TEST_OUTPUT="$OUTPUT_ROOT/.recovery-tests"
  rm -rf "$RECOVERY_TEST_OUTPUT"
  mkdir -p "$RECOVERY_TEST_OUTPUT"
  compile_recovery_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$RECOVERY_TEST_OUTPUT/private-vault-recovery-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -DANC_PRIVATE_VAULT_TESTING=1 \
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/storage" \
      -I"$SOURCE_ROOT/recovery" -I"$sodium_root/include" \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultMnemonic.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultRecoveryAuthority.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultRecoveryTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_recovery_test_slice arm64 "$ARM64_SODIUM"
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    compile_recovery_test_slice x86_64 "$X86_64_SODIUM"
  fi
  ;;
  *) echo "Invalid Private Vault recovery-test build mode" >&2; exit 1 ;;
esac

case "${PRIVATE_VAULT_BUILD_CANONICAL_TESTS:-}" in
  "") ;;
  1)
  CANONICAL_TEST_OUTPUT="$OUTPUT_ROOT/.canonical-tests"
  rm -rf "$CANONICAL_TEST_OUTPUT"
  mkdir -p "$CANONICAL_TEST_OUTPUT"
  compile_canonical_test_slice() {
    local architecture="$1"
    local output="$CANONICAL_TEST_OUTPUT/private-vault-canonical-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture" \
      -I"$SOURCE_ROOT/control" -framework Foundation \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonicalTests.m" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_canonical_test_slice arm64
  compile_canonical_test_slice x86_64
  ;;
  *) echo "Invalid Private Vault canonical-test build mode" >&2; exit 1 ;;
esac

case "${PRIVATE_VAULT_BUILD_ENDPOINT_REQUEST_TESTS:-}" in
  "") ;;
  1)
  ENDPOINT_REQUEST_TEST_OUTPUT="$OUTPUT_ROOT/.endpoint-request-tests"
  rm -rf "$ENDPOINT_REQUEST_TEST_OUTPUT"
  mkdir -p "$ENDPOINT_REQUEST_TEST_OUTPUT"
  compile_endpoint_request_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$ENDPOINT_REQUEST_TEST_OUTPUT/private-vault-endpoint-request-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$sodium_root/include" -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultEndpointRequest.m" \
      "$SOURCE_ROOT/control/PrivateVaultEndpointRequestTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_endpoint_request_test_slice arm64 "$ARM64_SODIUM"
  compile_endpoint_request_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *) echo "Invalid Private Vault endpoint-request-test build mode" >&2; exit 1 ;;
esac

case "${PRIVATE_VAULT_BUILD_HOSTED_APPEND_TRANSPORT_TESTS:-}" in
  "") ;;
  1)
  HOSTED_APPEND_TRANSPORT_TEST_OUTPUT="$OUTPUT_ROOT/.hosted-append-transport-tests"
  rm -rf "$HOSTED_APPEND_TRANSPORT_TEST_OUTPUT"
  mkdir -p "$HOSTED_APPEND_TRANSPORT_TEST_OUTPUT"
  compile_hosted_append_transport_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$HOSTED_APPEND_TRANSPORT_TEST_OUTPUT/private-vault-hosted-append-transport-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -DANC_PRIVATE_VAULT_TESTING=1 \
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture" \
      -I"$SOURCE_ROOT" -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$SOURCE_ROOT/transport" -I"$sodium_root/include" \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultEndpointRequest.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendTransport.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendTransportTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_hosted_append_transport_test_slice arm64 "$ARM64_SODIUM"
  compile_hosted_append_transport_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *) echo "Invalid Private Vault hosted-append-transport-test build mode" >&2; exit 1 ;;
esac

case "${PRIVATE_VAULT_BUILD_HOSTED_APPEND_RETRY_TESTS:-}" in
  "") ;;
  1)
  HOSTED_APPEND_RETRY_TEST_OUTPUT="$OUTPUT_ROOT/.hosted-append-retry-tests"
  rm -rf "$HOSTED_APPEND_RETRY_TEST_OUTPUT"
  mkdir -p "$HOSTED_APPEND_RETRY_TEST_OUTPUT"
  compile_hosted_append_retry_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local common=(
      -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror
      -DANC_PRIVATE_VAULT_TESTING=1
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture"
      -I"$SOURCE_ROOT" -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control"
      -I"$SOURCE_ROOT/storage" -I"$SOURCE_ROOT/transport"
      -I"$sodium_root/include" -framework Foundation
    )
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultHostedAppendRetryStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultHostedAppendRetryStoreTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-retry-store-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendRetryCoordinator.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendRetryCoordinatorTests.m" \
      -o "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-retry-coordinator-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpool.m" \
      "$SOURCE_ROOT/storage/PrivateVaultHostedAppendRetryStore.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendRetryCoordinator.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendCandidateIndex.m" \
      "$SOURCE_ROOT/transport/PrivateVaultHostedAppendCandidateIndexTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-candidate-index-tests-$architecture"
    lipo "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-retry-store-tests-$architecture" -verify_arch "$architecture"
    lipo "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-retry-coordinator-tests-$architecture" -verify_arch "$architecture"
    lipo "$HOSTED_APPEND_RETRY_TEST_OUTPUT/private-vault-hosted-append-candidate-index-tests-$architecture" -verify_arch "$architecture"
  }
  compile_hosted_append_retry_test_slice arm64 "$ARM64_SODIUM"
  compile_hosted_append_retry_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *) echo "Invalid Private Vault hosted-append-retry-test build mode" >&2; exit 1 ;;
esac

case "${PRIVATE_VAULT_BUILD_CONTROL_LOG_TESTS:-}" in
  "") ;;
  1)
  CONTROL_LOG_TEST_OUTPUT="$OUTPUT_ROOT/.control-log-tests"
  rm -rf "$CONTROL_LOG_TEST_OUTPUT"
  mkdir -p "$CONTROL_LOG_TEST_OUTPUT"
  compile_control_log_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local output="$CONTROL_LOG_TEST_OUTPUT/private-vault-control-log-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture" \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$sodium_root/include" -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  compile_control_log_test_slice arm64 "$ARM64_SODIUM"
  compile_control_log_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *) echo "Invalid Private Vault control-log-test build mode" >&2; exit 1 ;;
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

case "${PRIVATE_VAULT_BUILD_AUTHORITY_TESTS:-}" in
1 | true | TRUE | yes | YES)
  AUTHORITY_TEST_OUTPUT="$OUTPUT_ROOT/.authority-tests"
  rm -rf "$AUTHORITY_TEST_OUTPUT"
  mkdir -p "$AUTHORITY_TEST_OUTPUT"
  build_authority_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$AUTHORITY_TEST_OUTPUT/private-vault-authority-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$SOURCE_ROOT/storage" -I"$sodium_root/include" \
      -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_AUTHORITY_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-authority-store-vectors.json"'"' \
      -framework Foundation -framework Security -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshotTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_authority_tests arm64
  build_authority_tests x86_64
  ;;
esac

case "${PRIVATE_VAULT_BUILD_AUTHENTICATED_REPLAY_BRIDGE_TESTS:-}" in
1 | true | TRUE | yes | YES)
  BRIDGE_TEST_OUTPUT="$OUTPUT_ROOT/.authenticated-replay-bridge-tests"
  rm -rf "$BRIDGE_TEST_OUTPUT"
  mkdir -p "$BRIDGE_TEST_OUTPUT"
  build_authenticated_replay_bridge_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$BRIDGE_TEST_OUTPUT/private-vault-authenticated-replay-bridge-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$SOURCE_ROOT/storage" -I"$sodium_root/include" \
      -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_CONTROL_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-control-log-vectors.json"'"' \
      -framework Foundation -framework Security -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthenticatedReplayBridgeTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_authenticated_replay_bridge_tests arm64
  build_authenticated_replay_bridge_tests x86_64
  ;;
esac

case "${PRIVATE_VAULT_BUILD_RECOVERY_WRAP_TESTS:-}" in
1 | true | TRUE | yes | YES)
  RECOVERY_WRAP_TEST_OUTPUT="$OUTPUT_ROOT/.recovery-wrap-tests"
  rm -rf "$RECOVERY_WRAP_TEST_OUTPUT"
  mkdir -p "$RECOVERY_WRAP_TEST_OUTPUT"
  build_recovery_wrap_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$RECOVERY_WRAP_TEST_OUTPUT/private-vault-recovery-wrap-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$sodium_root/include" -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_RECOVERY_WRAP_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-recovery-wrap-vectors.json"'"' \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrapTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_recovery_wrap_tests arm64
  build_recovery_wrap_tests x86_64
  ;;
esac

case "${PRIVATE_VAULT_BUILD_GENESIS_BOOTSTRAP_TESTS:-}" in
1 | true | TRUE | yes | YES)
  GENESIS_BOOTSTRAP_TEST_OUTPUT="$OUTPUT_ROOT/.genesis-bootstrap-tests"
  rm -rf "$GENESIS_BOOTSTRAP_TEST_OUTPUT"
  mkdir -p "$GENESIS_BOOTSTRAP_TEST_OUTPUT"
  build_genesis_bootstrap_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$GENESIS_BOOTSTRAP_TEST_OUTPUT/private-vault-genesis-bootstrap-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$sodium_root/include" -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_GENESIS_BOOTSTRAP_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-genesis-bootstrap-vectors.json"'"' \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrapTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_genesis_bootstrap_tests arm64
  build_genesis_bootstrap_tests x86_64
  ;;
esac

case "${PRIVATE_VAULT_BUILD_GENESIS_AUTHORIZATION_TESTS:-}" in
1 | true | TRUE | yes | YES)
  GENESIS_AUTHORIZATION_TEST_OUTPUT="$OUTPUT_ROOT/.genesis-authorization-tests"
  rm -rf "$GENESIS_AUTHORIZATION_TEST_OUTPUT"
  mkdir -p "$GENESIS_AUTHORIZATION_TEST_OUTPUT"
  build_genesis_authorization_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$GENESIS_AUTHORIZATION_TEST_OUTPUT/private-vault-genesis-authorization-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" -I"$SOURCE_ROOT/storage" \
      -I"$sodium_root/include" -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-genesis-authorization-vectors.json"'"' \
      -framework Foundation -framework Security -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorizationTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_genesis_authorization_tests arm64
  build_genesis_authorization_tests x86_64
  ;;
esac

case "${PRIVATE_VAULT_BUILD_GENESIS_BUILDER_TESTS:-}" in
1 | true | TRUE | yes | YES)
  GENESIS_BUILDER_TEST_OUTPUT="$OUTPUT_ROOT/.genesis-builder-tests"
  rm -rf "$GENESIS_BUILDER_TEST_OUTPUT"
  mkdir -p "$GENESIS_BUILDER_TEST_OUTPUT"
  build_genesis_builder_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$GENESIS_BUILDER_TEST_OUTPUT/private-vault-genesis-builder-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" \
      -I"$SOURCE_ROOT/storage" -I"$SOURCE_ROOT/recovery" \
      -I"$sodium_root/include" -DANC_PRIVATE_VAULT_TESTING=1 \
      -framework Foundation \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBuilder.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultRecoveryAuthority.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBuilderTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_genesis_builder_tests arm64
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    build_genesis_builder_tests x86_64
  fi
  ;;
esac

case "${PRIVATE_VAULT_BUILD_GENESIS_COORDINATOR_TESTS:-}" in
1 | true | TRUE | yes | YES)
  GENESIS_COORDINATOR_TEST_OUTPUT="$OUTPUT_ROOT/.genesis-coordinator-tests"
  rm -rf "$GENESIS_COORDINATOR_TEST_OUTPUT"
  mkdir -p "$GENESIS_COORDINATOR_TEST_OUTPUT"
  build_genesis_coordinator_tests() {
    local architecture="$1"
    local sodium_root
    if [[ "$architecture" == "arm64" ]]; then sodium_root="$ARM64_SODIUM"; else sodium_root="$X86_64_SODIUM"; fi
    local output="$GENESIS_COORDINATOR_TEST_OUTPUT/private-vault-genesis-coordinator-tests-$architecture"
    xcrun clang -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror \
      -isysroot "$SDK" -arch "$architecture" -mmacosx-version-min=13.0 \
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" -I"$SOURCE_ROOT/storage" \
      -I"$SOURCE_ROOT/recovery" \
      -I"$sodium_root/include" -DANC_PRIVATE_VAULT_TESTING=1 \
      -DANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH='"'"$ROOT/../core/src/e2ee/fixtures/anc-v1-native-genesis-authorization-vectors.json"'"' \
      -framework Foundation -framework Security -framework LocalAuthentication \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBuilder.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultMnemonic.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultRecoveryAuthority.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisArtifactStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisLock.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationArtifactStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisCoordinator.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisStartup.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisCoordinatorTests.m" \
      "$sodium_root/lib/libsodium.a" -o "$output"
    lipo "$output" -verify_arch "$architecture"
  }
  build_genesis_coordinator_tests arm64
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    build_genesis_coordinator_tests x86_64
  fi
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
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    compile_fence_test_slice x86_64 "$X86_64_SODIUM"
  fi
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
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    compile_repository_test_slice x86_64 "$X86_64_SODIUM"
  fi
  ;;
  *)
    echo "Invalid Private Vault repository-test build mode" >&2
    exit 1
    ;;
esac

case "${PRIVATE_VAULT_BUILD_GENESIS_PREPARATION_STORAGE_TESTS:-}" in
  "") ;;
  1)
  GENESIS_PREPARATION_TEST_OUTPUT="$OUTPUT_ROOT/.genesis-preparation-storage-tests"
  rm -rf "$GENESIS_PREPARATION_TEST_OUTPUT"
  mkdir -p "$GENESIS_PREPARATION_TEST_OUTPUT"
  compile_genesis_preparation_storage_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local common=(
      -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror
      -DANC_PRIVATE_VAULT_TESTING=1
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture"
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control"
      -I"$SOURCE_ROOT/storage" -I"$SOURCE_ROOT/recovery"
      -I"$sodium_root/include"
      -framework Foundation -framework Security -framework LocalAuthentication
    )
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationRecordTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-record-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationArtifactStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationArtifactStoreTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-artifact-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBootstrap.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisAuthorization.m" \
      "$SOURCE_ROOT/control/PrivateVaultGenesisBuilder.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/recovery/PrivateVaultRecoveryAuthority.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationArtifactStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenesisPreparationStoreTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-store-tests-$architecture"
    lipo "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-record-tests-$architecture" \
      -verify_arch "$architecture"
    lipo "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-artifact-tests-$architecture" \
      -verify_arch "$architecture"
    lipo "$GENESIS_PREPARATION_TEST_OUTPUT/private-vault-genesis-preparation-store-tests-$architecture" \
      -verify_arch "$architecture"
  }
  compile_genesis_preparation_storage_test_slice arm64 "$ARM64_SODIUM"
  if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
    compile_genesis_preparation_storage_test_slice x86_64 "$X86_64_SODIUM"
  fi
  ;;
  *)
    echo "Invalid Private Vault genesis-preparation-storage-test build mode" >&2
    exit 1
    ;;
esac

case "${PRIVATE_VAULT_BUILD_ROTATION_PREPARATION_TESTS:-}" in
  "") ;;
  1)
  ROTATION_TEST_OUTPUT="$OUTPUT_ROOT/.rotation-preparation-tests"
  rm -rf "$ROTATION_TEST_OUTPUT"
  mkdir -p "$ROTATION_TEST_OUTPUT"
  compile_rotation_test_slice() {
    local architecture="$1"
    local sodium_root="$2"
    local common=(
      -O1 -fobjc-arc -fblocks -Wall -Wextra -Werror
      -DANC_PRIVATE_VAULT_TESTING=1
      -isysroot "$SDK" -mmacosx-version-min=13.0 -arch "$architecture"
      -I"$SOURCE_ROOT/crypto" -I"$SOURCE_ROOT/control" -I"$SOURCE_ROOT/storage"
      -I"$sodium_root/include"
      -framework Foundation -framework Security -framework LocalAuthentication
    )
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationRecordTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$ROTATION_TEST_OUTPUT/private-vault-rotation-record-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpool.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpoolTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$ROTATION_TEST_OUTPUT/private-vault-rotation-spool-tests-$architecture"
    xcrun clang "${common[@]}" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpool.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationStoreTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$ROTATION_TEST_OUTPUT/private-vault-rotation-store-tests-$architecture"
    xcrun clang "${common[@]}" \
      -I"$SOURCE_ROOT/control" \
      "$SOURCE_ROOT/crypto/PrivateVaultCrypto.c" \
      "$SOURCE_ROOT/control/PrivateVaultAncCanonical.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLog.m" \
      "$SOURCE_ROOT/control/PrivateVaultControlLogInternal.m" \
      "$SOURCE_ROOT/control/PrivateVaultEndpointRequest.m" \
      "$SOURCE_ROOT/control/PrivateVaultRecoveryWrap.m" \
      "$SOURCE_ROOT/storage/PrivateVaultKeychain.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGenerationFence.m" \
      "$SOURCE_ROOT/storage/PrivateVaultGuardedMemory.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultCustodyRepository.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthoritySnapshot.m" \
      "$SOURCE_ROOT/storage/PrivateVaultAuthorityStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationRecord.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationSpool.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationPreparationStore.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationCoordinator.m" \
      "$SOURCE_ROOT/storage/PrivateVaultRotationCoordinatorTests.m" \
      "$sodium_root/lib/libsodium.a" \
      -o "$ROTATION_TEST_OUTPUT/private-vault-rotation-coordinator-tests-$architecture"
    lipo "$ROTATION_TEST_OUTPUT/private-vault-rotation-record-tests-$architecture" \
      -verify_arch "$architecture"
    lipo "$ROTATION_TEST_OUTPUT/private-vault-rotation-spool-tests-$architecture" \
      -verify_arch "$architecture"
    lipo "$ROTATION_TEST_OUTPUT/private-vault-rotation-store-tests-$architecture" \
      -verify_arch "$architecture"
    lipo "$ROTATION_TEST_OUTPUT/private-vault-rotation-coordinator-tests-$architecture" \
      -verify_arch "$architecture"
  }
  compile_rotation_test_slice arm64 "$ARM64_SODIUM"
  compile_rotation_test_slice x86_64 "$X86_64_SODIUM"
  ;;
  *)
    echo "Invalid Private Vault rotation-preparation-test build mode" >&2
    exit 1
    ;;
esac

rm -rf "$BUNDLE"
mkdir -p "$MACOS" "$RESOURCES"
cp "$INFO_PLIST" "$CONTENTS/Info.plist"
cp "$THIRD_PARTY_NOTICES" "$RESOURCES/THIRD_PARTY_NOTICES.md"
if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
  lipo -create \
    "$INTERMEDIATES/service-arm64" \
    "$INTERMEDIATES/service-x86_64" \
    -output "$EXECUTABLE"
else
  cp "$INTERMEDIATES/service-arm64" "$EXECUTABLE"
fi
chmod 0755 "$EXECUTABLE"

plutil -lint "$CONTENTS/Info.plist" >/dev/null
if [[ "$PRIVATE_VAULT_BUILD_ARCHITECTURES" == "universal" ]]; then
  lipo "$EXECUTABLE" -verify_arch arm64 x86_64
else
  lipo "$EXECUTABLE" -verify_arch arm64
fi
if otool -L "$EXECUTABLE" | grep -i 'libsodium'; then
  echo "Private Vault service unexpectedly links a libsodium dynamic library" >&2
  exit 1
fi
printf '%s\n' "$BUNDLE"
