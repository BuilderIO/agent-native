import { defineNitroPlugin } from "@agent-native/core/server";

import { registerLocalFigmaQaUploadProvider } from "../lib/local-figma-qa-upload.js";

export default defineNitroPlugin(() => {
  registerLocalFigmaQaUploadProvider();
});
