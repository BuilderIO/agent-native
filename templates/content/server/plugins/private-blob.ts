import {
  registerPrivateBlobProvider,
  setPrivateBlobPublicUploadFallbackEnabled,
  vercelPrivateBlobProvider,
} from "@agent-native/core/private-blob";

/** Protected Content media must never fall back to publicly uploaded ciphertext. */
export default function contentPrivateBlobPlugin() {
  registerPrivateBlobProvider(vercelPrivateBlobProvider);
  setPrivateBlobPublicUploadFallbackEnabled(false);
}
