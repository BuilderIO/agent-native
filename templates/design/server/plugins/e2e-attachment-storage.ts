import {
  defineNitroPlugin,
  registerFileUploadProvider,
} from "@agent-native/core/server";

import { createE2EAttachmentStorageProvider } from "../lib/e2e-attachment-storage.js";

export default defineNitroPlugin(() => {
  registerFileUploadProvider(createE2EAttachmentStorageProvider());
});
