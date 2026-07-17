#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-retry-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_HOSTED_APPEND_RETRY_TESTS=1 \
  "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null

DIRECTORY="$OUTPUT/.hosted-append-retry-tests"
for test_name in \
  private-vault-hosted-append-retry-store-tests \
  private-vault-hosted-append-retry-coordinator-tests \
  private-vault-hosted-append-candidate-index-tests; do
  "$DIRECTORY/$test_name-arm64"
  arch -x86_64 "$DIRECTORY/$test_name-x86_64"
done
