#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-canonical-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_CANONICAL_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.canonical-tests/private-vault-canonical-tests-arm64"
arch -x86_64 "$OUTPUT/.canonical-tests/private-vault-canonical-tests-x86_64"
