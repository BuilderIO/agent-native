import {
  FileUploadReadError,
  readUploadedFile,
} from "@agent-native/core/file-upload";

import {
  NativeTextureProviderError,
  readNativeTextureProviderWith,
} from "./design-native-texture-provider-policy";
import {
  isLocalFigmaQaUploadEnabled,
  LocalFigmaQaExportAssetError,
  readLocalFigmaQaAssetForExport,
} from "./local-figma-qa-upload";

export { NativeTextureProviderError } from "./design-native-texture-provider-policy";

export async function readDesignNativeTextureProvider(
  url: string,
  ownerEmail: string,
  maxBytes: number,
): Promise<{ mimeType: string; data: Uint8Array }> {
  return readNativeTextureProviderWith(
    { url, ownerEmail, maxBytes },
    {
      localQaEnabled: isLocalFigmaQaUploadEnabled,
      async readLocal(path, owner, limit) {
        try {
          const result = await readLocalFigmaQaAssetForExport(path, owner, {
            maxBytes: limit,
          });
          return { mimeType: result.mimeType, data: result.bytes };
        } catch (error) {
          if (error instanceof LocalFigmaQaExportAssetError)
            throw new NativeTextureProviderError(error.code, error.message);
          throw error;
        }
      },
      async readHttps(path, owner, limit) {
        try {
          return await readUploadedFile({
            url: path,
            ownerEmail: owner,
            maxBytes: limit,
          });
        } catch (error) {
          if (error instanceof FileUploadReadError)
            throw new NativeTextureProviderError(error.code, error.message);
          throw error;
        }
      },
    },
  );
}
