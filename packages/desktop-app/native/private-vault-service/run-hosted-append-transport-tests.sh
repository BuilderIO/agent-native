#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-hosted-append-transport-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

PRIVATE_VAULT_BUILD_HOSTED_APPEND_TRANSPORT_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.hosted-append-transport-tests/private-vault-hosted-append-transport-tests-arm64"
arch -x86_64 "$OUTPUT/.hosted-append-transport-tests/private-vault-hosted-append-transport-tests-x86_64"
