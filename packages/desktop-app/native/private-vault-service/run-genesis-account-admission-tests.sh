#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-genesis-admission-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_GENESIS_ACCOUNT_ADMISSION_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.genesis-account-admission-tests/private-vault-genesis-account-admission-tests-arm64"
arch -x86_64 "$OUTPUT/.genesis-account-admission-tests/private-vault-genesis-account-admission-tests-x86_64"
