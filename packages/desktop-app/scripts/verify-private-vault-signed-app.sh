#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: verify-private-vault-signed-app.sh <Agent Native.app>" >&2
  exit 64
fi

APP="$1"
TEAM_ID="W3PMF2T3MW"
XPC="$APP/Contents/XPCServices/com.agentnative.desktop.private-vault-service.xpc"
XPC_EXECUTABLE="$XPC/Contents/MacOS/AgentNativePrivateVaultService"
ADDON="$APP/Contents/Resources/native/private-vault-xpc-client.node"

fail() {
  echo "Private Vault signed-app verification failed" >&2
  exit 1
}

for path in "$APP" "$XPC" "$XPC_EXECUTABLE" "$ADDON"; do
  [ -e "$path" ] || fail
  [ ! -L "$path" ] || fail
done

case "$(realpath "$XPC")" in
  "$(realpath "$APP")"/Contents/XPCServices/*) ;;
  *) fail ;;
esac
case "$(realpath "$XPC_EXECUTABLE")" in
  "$(realpath "$XPC")"/Contents/MacOS/*) ;;
  *) fail ;;
esac
case "$(realpath "$ADDON")" in
  "$(realpath "$APP")"/Contents/Resources/native/*) ;;
  *) fail ;;
esac

codesign --verify --deep --strict --verbose=2 "$APP"
codesign --verify --strict --verbose=2 "$XPC"
codesign --verify --strict --verbose=2 "$XPC_EXECUTABLE"
codesign --verify --strict --verbose=2 "$ADDON"

verify_signature() {
  local path="$1"
  local identifier="$2"
  local detail
  local requirement
  detail="$(codesign -dv --verbose=4 "$path" 2>&1)"
  requirement="$(codesign -dr - "$path" 2>&1)"
  grep -Fq "TeamIdentifier=$TEAM_ID" <<<"$detail" || fail
  grep -Fq "Identifier=$identifier" <<<"$detail" || fail
  grep -Fq "identifier \"$identifier\"" <<<"$requirement" || fail
  grep -Fq "anchor apple generic" <<<"$requirement" || fail
  grep -Fq "certificate leaf[subject.OU] = \"$TEAM_ID\"" <<<"$requirement" || fail
}

verify_team() {
  local detail
  local requirement
  detail="$(codesign -dv --verbose=4 "$1" 2>&1)"
  requirement="$(codesign -dr - "$1" 2>&1)"
  grep -Fq "TeamIdentifier=$TEAM_ID" <<<"$detail" || fail
  grep -Fq "anchor apple generic" <<<"$requirement" || fail
  grep -Fq "certificate leaf[subject.OU] = \"$TEAM_ID\"" <<<"$requirement" || fail
}

verify_signature "$APP" "com.agentnative.desktop"
verify_signature "$XPC" "com.agentnative.desktop.private-vault-service"
verify_team "$XPC_EXECUTABLE"
verify_team "$ADDON"

ENTITLEMENTS="$(mktemp "${TMPDIR:-/tmp}/private-vault-entitlements.XXXXXX")"
ENTITLEMENTS_JSON="$(mktemp "${TMPDIR:-/tmp}/private-vault-entitlements-json.XXXXXX")"
cleanup() {
  rm -f "$ENTITLEMENTS" "$ENTITLEMENTS_JSON"
}
trap cleanup EXIT
codesign -d --entitlements :- "$XPC" >"$ENTITLEMENTS" 2>/dev/null
plutil -lint "$ENTITLEMENTS" >/dev/null
plutil -convert json -o "$ENTITLEMENTS_JSON" "$ENTITLEMENTS"
node - "$ENTITLEMENTS_JSON" "$TEAM_ID" <<'NODE' || fail
const { readFileSync } = require("node:fs");

const actual = JSON.parse(readFileSync(process.argv[2], "utf8"));
const teamId = process.argv[3];
const expected = {
  "com.apple.security.app-sandbox": true,
  "com.apple.security.network.client": true,
  "keychain-access-groups": [
    `${teamId}.com.agentnative.desktop.private-vault`,
  ],
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};
if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
  process.exit(1);
}
NODE

lipo "$XPC_EXECUTABLE" -verify_arch arm64 x86_64
lipo "$ADDON" -verify_arch arm64 x86_64

shasum -a 256 "$XPC_EXECUTABLE" "$ADDON"
echo "Private Vault signed app verification passed"
