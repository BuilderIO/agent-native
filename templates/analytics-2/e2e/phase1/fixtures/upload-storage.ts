import { randomUUID } from "node:crypto";

import type { FileUploadProvider } from "@agent-native/core/file-upload";

export function createPhase1UploadStorage(port: number) {
  const origin = `http://127.0.0.1:${port}`;
  const files = new Map<string, Buffer>();
  const provider: FileUploadProvider = {
    id: "phase1-upload",
    name: "Phase 1 upload storage",
    isConfigured: () => true,
    async upload({ data, mimeType, recordAsset }) {
      if (mimeType !== "application/octet-stream" || recordAsset !== false)
        throw new Error("Expected an encrypted Phase 1 fixture upload");
      const id = randomUUID();
      const path = `/phase1/uploads/${id}`;
      files.set(path, Buffer.from(data));
      return { id, url: origin + path, provider: "phase1-upload" };
    },
    async delete({ url }) {
      const address = new URL(url);
      if (address.origin !== origin) return false;
      files.delete(address.pathname);
      return true;
    },
  };
  return { provider, read: (path: string) => files.get(path) };
}
