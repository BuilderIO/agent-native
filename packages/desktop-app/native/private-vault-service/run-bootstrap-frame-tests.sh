#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-bootstrap-frame-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_BOOTSTRAP_FRAME_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.bootstrap-frame-tests/private-vault-bootstrap-frame-tests-arm64"
arch -x86_64 "$OUTPUT/.bootstrap-frame-tests/private-vault-bootstrap-frame-tests-x86_64"
