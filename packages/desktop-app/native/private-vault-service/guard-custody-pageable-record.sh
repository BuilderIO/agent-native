#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPOSITORY="$ROOT/storage/PrivateVaultCustodyRepository.m"
RECORD="$ROOT/storage/PrivateVaultCustodyRecord.m"
KEYCHAIN="$ROOT/storage/PrivateVaultKeychain.m"

forbidden_repository="$({
  rg -n 'copyDataForService|consumeBytesForService|addBytes:|updateBytes:|addData:|updateData:|deleteDataForService|calloc\(ANC_PV_CUSTODY_RECORD_BYTES|uint8_t [A-Za-z_][A-Za-z0-9_]*\[ANC_PV_CUSTODY_RECORD_BYTES\]' "$REPOSITORY" || true
  rg -n '\[NSData dataWithBytes:' "$REPOSITORY" | rg -v 'digest\.bytes length:32' || true
})"
if [[ -n "$forbidden_repository" ]]; then
  echo "ordinary-memory custody record construction is forbidden:" >&2
  echo "$forbidden_repository" >&2
  exit 1
fi

generic_custody_calls="$(
  rg -UPn --glob '*.m' --glob '!*Tests.m' --glob '!PrivateVaultKeychain.m' \
    '(copyDataForService|consumeBytesForService|addBytes|updateBytes|addData|updateData|deleteDataForService):(?s:.{0,500})AncPrivateVaultCustody(Stage)?Service' \
    "$ROOT" || true
)"
if [[ -n "$generic_custody_calls" ]]; then
  echo "production custody access must use exact Keychain selectors:" >&2
  echo "$generic_custody_calls" >&2
  exit 1
fi

exact_selector_body="$(sed -n '/consumeCustodyRecordForService:/,/consumeGenesisPreparationRecordForService:/p' "$KEYCHAIN")"
if rg -n '\[self (consumeBytesForService|addBytes:|updateBytes:|deleteDataForService:)' \
  <<<"$exact_selector_body"; then
  echo "exact custody selectors must call private core helpers" >&2
  exit 1
fi

if rg -n 'input\[sizeof kAncPrivateVaultCustodyChecksumDomain' "$RECORD"; then
  echo "custody checksum must stream the record instead of concatenating it" >&2
  exit 1
fi

rg -q 'memoryWithLength:ANC_PV_CUSTODY_RECORD_BYTES' "$REPOSITORY"
rg -q 'anc_pv_blake2b_256_two_part' "$REPOSITORY"
rg -q 'anc_pv_blake2b_256_two_part' "$RECORD"
rg -q 'custodyExact && length != ANC_PV_CUSTODY_RECORD_BYTES' "$KEYCHAIN"
rg -q 'boundaryLength == ANC_PV_CUSTODY_RECORD_BYTES' "$KEYCHAIN"
