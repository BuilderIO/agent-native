#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-export-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_EXPORT_ARCHIVE_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.export-archive-tests/private-vault-export-archive-tests-arm64"
if [[ "$(uname -m)" == "arm64" ]]; then
  arch -x86_64 "$OUTPUT/.export-archive-tests/private-vault-export-archive-tests-x86_64"
else
  "$OUTPUT/.export-archive-tests/private-vault-export-archive-tests-x86_64"
fi
