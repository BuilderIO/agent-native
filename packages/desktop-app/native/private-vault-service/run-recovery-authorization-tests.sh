#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-recovery-authorization-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_RECOVERY_AUTHORIZATION_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.recovery-authorization-tests/private-vault-recovery-authorization-tests-arm64"
arch -x86_64 "$OUTPUT/.recovery-authorization-tests/private-vault-recovery-authorization-tests-x86_64"
