import { defineNitroPlugin } from "@agent-native/core/server";

import { registerLocalImportAssetUploadProvider } from "../lib/local-import-asset-upload.js";

export default defineNitroPlugin(() => {
  registerLocalImportAssetUploadProvider();
});
