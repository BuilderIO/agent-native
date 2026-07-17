#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-recovery-wrap-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_RECOVERY_WRAP_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.recovery-wrap-tests/private-vault-recovery-wrap-tests-arm64"
arch -x86_64 "$OUTPUT/.recovery-wrap-tests/private-vault-recovery-wrap-tests-x86_64"
