import { isPrivateBlobConfiguredForRequest } from "@agent-native/core/private-blob";

import { isHostedSlidesRuntime } from "./uploaded-reference-storage.js";

export async function isSlides2UploadStorageReady(): Promise<boolean> {
  return (
    !isHostedSlidesRuntime() || (await isPrivateBlobConfiguredForRequest())
  );
}
