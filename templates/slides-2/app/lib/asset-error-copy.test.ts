import { describe, expect, it } from "vitest";

import {
  assetErrorTranslationKey,
  isAssetStorageSetupError,
} from "./asset-error-copy";

describe("assetErrorTranslationKey", () => {
  it("maps upload and list failures to localized operation copy", () => {
    expect(
      assetErrorTranslationKey("image_upload_storage_unavailable", "upload"),
    ).toBe("storageUnavailable");
    expect(assetErrorTranslationKey("asset_deck_access_denied", "list")).toBe(
      "accessDenied",
    );
    expect(assetErrorTranslationKey("asset_list_failed", "list")).toBe(
      "listFailed",
    );
    expect(
      assetErrorTranslationKey("upload_service_unavailable", "upload"),
    ).toBe("uploadServiceUnavailable");
  });

  it("uses generic translated copy for unknown codes without forwarding details", () => {
    expect(
      assetErrorTranslationKey(
        "provider_failure_private-id-42: secret diagnostics",
        "upload",
      ),
    ).toBe("uploadFailed");
    expect(assetErrorTranslationKey(undefined, "list")).toBe("listFailed");
  });
});

describe("isAssetStorageSetupError", () => {
  it("opens setup only for the typed missing-storage error", () => {
    expect(isAssetStorageSetupError("image_upload_storage_unavailable")).toBe(
      true,
    );
    expect(
      isAssetStorageSetupError("Image upload failed: provider secret"),
    ).toBe(false);
    expect(isAssetStorageSetupError(undefined)).toBe(false);
  });
});
