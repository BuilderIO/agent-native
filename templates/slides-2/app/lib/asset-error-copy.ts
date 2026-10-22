export type AssetErrorOperation = "list" | "upload";

export type AssetErrorTranslationKey =
  | "accessDenied"
  | "assetSaveFailed"
  | "deckUnavailable"
  | "invalidDeck"
  | "invalidScope"
  | "listFailed"
  | "missingFile"
  | "signInRequired"
  | "storageFailed"
  | "storageUnavailable"
  | "tooLarge"
  | "unsupportedType"
  | "uploadFailed"
  | "uploadRequestFailed"
  | "uploadServiceUnavailable"
  | "invalidImage";

const errorTranslationKeys: Record<string, AssetErrorTranslationKey> = {
  asset_deck_access_denied: "accessDenied",
  asset_deck_scope_forbidden: "accessDenied",
  asset_deck_scope_invalid: "invalidScope",
  asset_list_auth_required: "signInRequired",
  asset_list_failed: "listFailed",
  deck_not_found: "deckUnavailable",
  image_asset_registration_failed: "assetSaveFailed",
  image_upload_auth_required: "signInRequired",
  image_upload_failed: "uploadFailed",
  image_upload_file_missing: "missingFile",
  image_upload_invalid_image: "invalidImage",
  image_upload_request_invalid: "uploadRequestFailed",
  image_upload_scope_check_failed: "uploadFailed",
  image_upload_session_unavailable: "uploadServiceUnavailable",
  image_upload_storage_failed: "storageFailed",
  image_upload_storage_unavailable: "storageUnavailable",
  image_upload_too_large: "tooLarge",
  image_upload_unsupported_type: "unsupportedType",
  image_upload_unsafe_svg: "invalidImage",
  invalid_deck_data: "invalidDeck",
  invalid_deck_id: "invalidScope",
  upload_service_unavailable: "uploadServiceUnavailable",
};

export function assetErrorTranslationKey(
  errorCode: unknown,
  operation: AssetErrorOperation,
): AssetErrorTranslationKey {
  if (typeof errorCode === "string") {
    const key = errorTranslationKeys[errorCode];
    if (key) return key;
  }
  return operation === "list" ? "listFailed" : "uploadFailed";
}

export function isAssetStorageSetupError(errorCode: unknown): boolean {
  return errorCode === "image_upload_storage_unavailable";
}
