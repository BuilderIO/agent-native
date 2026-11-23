import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { noteExternalWrite } from "@agent-native/core/action";
import {
  getPrivateBlobStorageReadinessForRequest,
  PrivateBlobError,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { getAppConfig } from "@agent-native/core/server";
import {
  resolveDeployEnvironment,
  resolveDeployPlatform,
} from "@agent-native/core/server/deploy-environment";

export const notebookResultBlobPurpose = "analytics2-notebook-result";

function localDeployment() {
  const platform = resolveDeployPlatform();
  return (
    (platform === "local" || platform === "node") &&
    resolveDeployEnvironment() === "local"
  );
}

export function localNotebookBlobProvider(): PrivateBlobProvider {
  const root = resolve("data/notebook-results");
  const provider = "analytics2-local-notebook-results";
  function blobPath(id: string) {
    if (!localDeployment())
      throw new PrivateBlobError(
        "Local notebook result storage requires a local deployment.",
        "not_configured",
      );
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
      throw new PrivateBlobError(
        "Invalid local notebook result ID.",
        "corrupt",
      );
    return join(root, id);
  }
  return {
    id: provider,
    name: "Local notebook results",
    handles: ({ metadata }) => metadata?.purpose === notebookResultBlobPurpose,
    isConfigured: () =>
      localDeployment() && getAppConfig().privateBlob.provider === provider,
    isConfiguredForRequest: async () =>
      localDeployment() &&
      !(await getPrivateBlobStorageReadinessForRequest()).configured,
    async put({ data, mimeType, metadata }) {
      const id = randomUUID();
      const path = blobPath(id);
      noteExternalWrite("local-notebook-blob");
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(path, data, { flag: "wx", mode: 0o600 });
      return {
        id,
        provider,
        opaque: true,
        encrypted: false,
        size: data.byteLength,
        ...(mimeType === undefined ? {} : { mimeType }),
        ...(metadata === undefined ? {} : { metadata }),
      };
    },
    async read(handle) {
      const path = blobPath(handle.id);
      try {
        const data = await readFile(path);
        return { data, handle };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw new PrivateBlobError(
            "Local notebook result is missing.",
            "not_found",
            {
              cause: error,
            },
          );
        throw error;
      }
    },
    async delete(handle) {
      const path = blobPath(handle.id);
      noteExternalWrite("local-notebook-blob");
      await rm(path, { force: true });
      return { deleted: true, provider };
    },
  };
}
