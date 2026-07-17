#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-replay-bridge-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_AUTHENTICATED_REPLAY_BRIDGE_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.authenticated-replay-bridge-tests/private-vault-authenticated-replay-bridge-tests-arm64"
arch -x86_64 "$OUTPUT/.authenticated-replay-bridge-tests/private-vault-authenticated-replay-bridge-tests-x86_64"
