#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-rotation-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_ROTATION_PREPARATION_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null

FIXTURE="$ROOT/../core/src/e2ee/fixtures/anc-v1-native-rotation-preparation-vectors.json"
for architecture in arm64 x86_64; do
  DIRECTORY="$OUTPUT/.rotation-preparation-tests"
  if [[ "$architecture" == arm64 ]]; then
    "$DIRECTORY/private-vault-endpoint-removal-builder-tests-$architecture"
    "$DIRECTORY/private-vault-rotation-record-tests-$architecture" "$FIXTURE"
    pnpm --dir "$ROOT/.." --filter @agent-native/core exec tsx \
      scripts/materialize-native-rotation-preparation-vectors.ts \
      --ephemeral-material-stdout --fixture "$FIXTURE" | \
      "$DIRECTORY/private-vault-rotation-spool-tests-$architecture" "$FIXTURE"
    "$DIRECTORY/private-vault-rotation-store-tests-$architecture"
    pnpm --dir "$ROOT/.." --filter @agent-native/core exec tsx \
      scripts/materialize-native-rotation-preparation-vectors.ts \
      --ephemeral-material-stdout --fixture "$FIXTURE" | \
      "$DIRECTORY/private-vault-rotation-coordinator-tests-$architecture"
  else
    arch -x86_64 "$DIRECTORY/private-vault-endpoint-removal-builder-tests-$architecture"
    arch -x86_64 "$DIRECTORY/private-vault-rotation-record-tests-$architecture" "$FIXTURE"
    pnpm --dir "$ROOT/.." --filter @agent-native/core exec tsx \
      scripts/materialize-native-rotation-preparation-vectors.ts \
      --ephemeral-material-stdout --fixture "$FIXTURE" | \
      arch -x86_64 "$DIRECTORY/private-vault-rotation-spool-tests-$architecture" "$FIXTURE"
    arch -x86_64 "$DIRECTORY/private-vault-rotation-store-tests-$architecture"
    pnpm --dir "$ROOT/.." --filter @agent-native/core exec tsx \
      scripts/materialize-native-rotation-preparation-vectors.ts \
      --ephemeral-material-stdout --fixture "$FIXTURE" | \
      arch -x86_64 "$DIRECTORY/private-vault-rotation-coordinator-tests-$architecture"
  fi
done
