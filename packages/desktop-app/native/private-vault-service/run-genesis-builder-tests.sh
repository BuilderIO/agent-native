#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-genesis-builder-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_ARCHITECTURES=arm64 \
PRIVATE_VAULT_BUILD_GENESIS_BUILDER_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
pnpm --dir "$ROOT/../core" exec tsx \
  scripts/materialize-native-genesis-preparation-oracle.ts | \
  "$OUTPUT/.genesis-builder-tests/private-vault-genesis-builder-tests-arm64"
