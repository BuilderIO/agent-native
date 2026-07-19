import { describe, expect, it, vi } from "vitest";

import type {
  PrivateVaultContentDocument,
  PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import { PrivateVaultContentDocumentRuntime } from "./content-document-runtime.js";

const vaultId = "11".repeat(16);

function harness() {
  let head: PrivateVaultLocalManifestHead | null = null;
  const documents = new Map<string, PrivateVaultContentDocument>();
  let revision = 4;
  const index = {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(),
    readManifest: vi.fn(async () => head),
    writeManifest: vi.fn(async (value: PrivateVaultLocalManifestHead) => {
      head = value;
    }),
    readDocument: vi.fn(
      async (_vaultId: string, objectId: string, revisionId: string) =>
        documents.get(`${objectId}:${revisionId}`) ?? null,
    ),
    writeDocument: vi.fn(
      async (
        _vaultId: string,
        revisionId: string,
        document: PrivateVaultContentDocument,
      ) => {
        documents.set(`${document.id}:${revisionId}`, document);
      },
    ),
  };
  const transport = { list: vi.fn(async () => []) };
  const objects = {
    sealAndUpload: vi.fn(async () => ({
      revisionId: String(revision++).repeat(64),
      epoch: 1,
      plaintextLength: 1,
      ciphertextByteLength: 1,
    })),
    downloadAndOpen: vi.fn(),
  };
  return {
    index,
    objects,
    runtime: new PrivateVaultContentDocumentRuntime({
      index: index as never,
      transport: transport as never,
      objects: objects as never,
    }),
  };
}

describe("PrivateVaultContentDocumentRuntime", () => {
  it("composes sync, encrypted writes, and familiar local reads", async () => {
    const source = harness();
    await source.runtime.initialize(vaultId);
    const created = await source.runtime.createDocument(vaultId, {
      id: "22".repeat(16),
      title: "A signed Desktop document",
      content: "No remote webview sees this.",
    });
    const listed = await source.runtime.listDocuments(vaultId);
    const read = await source.runtime.getDocument(vaultId, created.id);
    const searched = await source.runtime.searchDocuments(vaultId, "remote");

    expect(source.index.initialize).toHaveBeenCalledOnce();
    expect(source.objects.sealAndUpload).toHaveBeenCalledTimes(2);
    expect(listed.documents).toHaveLength(1);
    expect(read.content).toBe("No remote webview sees this.");
    expect(searched.documents[0]?.id).toBe(created.id);
  });

  it("fails closed before initialization and after close", async () => {
    const source = harness();
    await expect(source.runtime.listDocuments(vaultId)).rejects.toThrow(
      "unavailable",
    );
    await source.runtime.initialize(vaultId);
    source.runtime.close();
    await expect(source.runtime.listDocuments(vaultId)).rejects.toThrow(
      "unavailable",
    );
    expect(source.index.close).toHaveBeenCalledOnce();
  });
});
