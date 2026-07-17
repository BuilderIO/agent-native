#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_ROOT="$ROOT/native/private-vault-service"
# Path is anchored to this script at runtime.
# shellcheck disable=SC1091
source "$SERVICE_ROOT/libsodium-version.env"

VENDOR_ROOT="$SERVICE_ROOT/.build/vendor"
ARCHIVE="$VENDOR_ROOT/libsodium-$LIBSODIUM_COMMIT.tar.gz"
DOWNLOAD="$(mktemp "${TMPDIR:-/tmp}/libsodium.XXXXXX.tar.gz")"
SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/libsodium-snapshot.XXXXXX.tar.gz")"
mkdir -p "$VENDOR_ROOT"
EXTRACT_ROOT="$(mktemp -d "$VENDOR_ROOT/libsodium-extract.XXXXXX")"

cleanup() {
  rm -f "$DOWNLOAD"
  rm -f "$SNAPSHOT"
  rm -rf "$EXTRACT_ROOT"
}
trap cleanup EXIT

if [[ ! -f "$ARCHIVE" ]] || \
  [[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" != "$LIBSODIUM_ARCHIVE_SHA256" ]]; then
  curl --fail --silent --show-error --location \
    --proto '=https' --tlsv1.2 \
    "$LIBSODIUM_ARCHIVE_URL" \
    --output "$DOWNLOAD"

  ACTUAL_SHA256="$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')"
  if [[ "$ACTUAL_SHA256" != "$LIBSODIUM_ARCHIVE_SHA256" ]]; then
    echo "Private Vault dependency verification failed" >&2
    exit 1
  fi
  mv "$DOWNLOAD" "$ARCHIVE"
fi

# Copy the cache to a private inode, then verify and consume only that exact
# snapshot. A concurrent cache replacement can no longer change bytes between
# verification and extraction.
cp "$ARCHIVE" "$SNAPSHOT"
chmod 0600 "$SNAPSHOT"
ACTUAL_SHA256="$(shasum -a 256 "$SNAPSHOT" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$LIBSODIUM_ARCHIVE_SHA256" ]]; then
  echo "Private Vault dependency verification failed" >&2
  exit 1
fi

EXPECTED_ROOT="libsodium-$LIBSODIUM_COMMIT"
while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  case "$entry" in
    /*|../*|*/../*|*/..)
      echo "Private Vault dependency archive contains an unsafe path" >&2
      exit 1
      ;;
    "$EXPECTED_ROOT"|"$EXPECTED_ROOT"/*) ;;
    *)
      echo "Private Vault dependency archive has an unexpected root" >&2
      exit 1
      ;;
  esac
done < <(tar -tzf "$SNAPSHOT")

# GitHub's pinned archive contains regular files and directories only. Reject
# links and special files before extraction so an archive cannot escape through
# a symlink even if the upstream object is ever replaced.
if tar -tzvf "$SNAPSHOT" | awk 'substr($1, 1, 1) != "d" && substr($1, 1, 1) != "-" { exit 1 }'; then
  :
else
  echo "Private Vault dependency archive contains a non-regular entry" >&2
  exit 1
fi

tar -xzf "$SNAPSHOT" -C "$EXTRACT_ROOT" --no-same-owner --no-same-permissions
[[ -d "$EXTRACT_ROOT/$EXPECTED_ROOT" ]]
[[ ! -L "$EXTRACT_ROOT/$EXPECTED_ROOT" ]]

SOURCE_DIR="$VENDOR_ROOT/source-$(basename "$EXTRACT_ROOT" | sed 's/^libsodium-extract\.//')"
mv "$EXTRACT_ROOT/$EXPECTED_ROOT" "$SOURCE_DIR"

printf '%s\n' "$SOURCE_DIR"
