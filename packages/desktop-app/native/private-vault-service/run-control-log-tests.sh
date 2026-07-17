#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/agent-native-private-vault-control-log-tests.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT

if [[ $# -ne 1 ]]; then
  echo "usage: $0 core-fixture.json" >&2
  exit 2
fi
export ANC_V1_CONTROL_LOG_FIXTURE_PATH="$1"
export ANC_V1_CONTROL_LOG_SOURCE_ROOT="$REPO_ROOT"

PRIVATE_VAULT_BUILD_CONTROL_LOG_TESTS=1 \
  bash "$ROOT/native/build-private-vault-service.sh" "$OUTPUT" >/dev/null
"$OUTPUT/.control-log-tests/private-vault-control-log-tests-arm64"
arch -x86_64 "$OUTPUT/.control-log-tests/private-vault-control-log-tests-x86_64"
