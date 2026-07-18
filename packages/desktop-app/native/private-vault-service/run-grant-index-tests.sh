#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-grant-index-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_GRANT_INDEX_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.grant-index-tests/private-vault-grant-index-tests-arm64"
arch -x86_64 "$OUTPUT/.grant-index-tests/private-vault-grant-index-tests-x86_64"
