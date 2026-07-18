#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-bootstrap-replay-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_BOOTSTRAP_REPLAY_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.bootstrap-replay-tests/private-vault-bootstrap-replay-tests-arm64"
arch -x86_64 "$OUTPUT/.bootstrap-replay-tests/private-vault-bootstrap-replay-tests-x86_64"
