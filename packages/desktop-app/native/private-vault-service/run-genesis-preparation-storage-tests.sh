#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-genesis-storage-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_ARCHITECTURES=arm64 \
PRIVATE_VAULT_BUILD_GENESIS_PREPARATION_STORAGE_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null

DIRECTORY="$OUTPUT/.genesis-preparation-storage-tests"
"$DIRECTORY/private-vault-genesis-preparation-record-tests-arm64"
"$DIRECTORY/private-vault-genesis-preparation-artifact-tests-arm64"
"$DIRECTORY/private-vault-genesis-preparation-store-tests-arm64"
