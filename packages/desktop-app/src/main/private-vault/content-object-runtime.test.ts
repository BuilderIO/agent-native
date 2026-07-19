import { describe, expect, it, vi } from "vitest";

import { PrivateVaultContentObjectRuntime } from "./content-object-runtime.js";

const vaultId = "10".repeat(16);
const objectId = "20".repeat(16);
const revisionId = "30".repeat(32);

function transport() {
  return {
    put: vi.fn(async (input) => ({
      ...input.coordinate,
      objectType: "document" as const,
      algorithmId: "anc/v1" as const,
      revision: input.revision,
      epoch: input.epoch,
      parentRevisionIds: input.parentRevisionIds ?? [],
      ciphertextByteLength: input.ciphertext.byteLength,
    })),
    get: vi.fn(async () => ({
      ciphertext: Uint8Array.of(0xa4, 1, 2, 3),
      metadata: {
        objectType: "document" as const,
        algorithmId: "anc/v1" as const,
        revision: 3,
        epoch: 7,
        parentRevisionIds: [],
        ciphertextByteLength: 4,
      },
    })),
  };
}

describe("Private Vault Content object runtime", () => {
  it("binds a vault manifest MIME type to its distinct hosted object type", async () => {
    const encodedRevision = Uint8Array.of(0xa4, 1, 2, 3);
    const native = {
      sealContentObjectRevision: vi.fn(async (input) => ({
        version: 1 as const,
        suite: "anc/v1" as const,
        operation: "seal_object" as const,
        state: "sealed" as const,
        vaultId,
        objectId,
        revision: input.revision,
        epoch: 7,
        revisionId: Buffer.from(revisionId, "hex"),
        contentType: input.contentType!,
        plaintextLength: input.plaintext.byteLength,
        encodedRevision,
      })),
      openContentObjectRevision: vi.fn(),
    };
    const hosted = transport();
    const runtime = new PrivateVaultContentObjectRuntime(native);

    await runtime.sealAndUpload({
      transport: hosted as never,
      vaultId,
      objectId,
      revision: 1,
      contentType: "application/vnd.agent-native.content-vault-manifest+json",
      plaintext: Uint8Array.from(Buffer.from('{"kind":"manifest"}')),
      parentRevisionIds: [],
    });

    expect(hosted.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectType: "vault-manifest", revision: 1 }),
    );
    expect(encodedRevision).toEqual(new Uint8Array(4));
  });

  it("seals before upload and returns content-free coordinates", async () => {
    const encodedRevision = Uint8Array.of(0xa4, 1, 2, 3);
    const native = {
      sealContentObjectRevision: vi.fn(async () => ({
        version: 1 as const,
        suite: "anc/v1" as const,
        operation: "seal_object" as const,
        state: "sealed" as const,
        vaultId,
        objectId,
        revision: 3,
        epoch: 7,
        revisionId: Buffer.from(revisionId, "hex"),
        contentType:
          "application/vnd.agent-native.content-document+json" as const,
        plaintextLength: 16,
        encodedRevision,
      })),
      openContentObjectRevision: vi.fn(),
    };
    const hosted = transport();
    let uploaded = new Uint8Array();
    hosted.put.mockImplementationOnce(async (input) => {
      uploaded = input.ciphertext.slice();
      return {
        ...input.coordinate,
        objectType: "document" as const,
        algorithmId: "anc/v1" as const,
        revision: input.revision,
        epoch: input.epoch,
        parentRevisionIds: input.parentRevisionIds ?? [],
        ciphertextByteLength: input.ciphertext.byteLength,
      };
    });
    const runtime = new PrivateVaultContentObjectRuntime(native);
    await expect(
      runtime.sealAndUpload({
        transport: hosted as never,
        vaultId,
        objectId,
        revision: 3,
        plaintext: Uint8Array.from(Buffer.from('{"title":"Moon"}')),
      }),
    ).resolves.toEqual({
      revisionId,
      epoch: 7,
      plaintextLength: 16,
      ciphertextByteLength: 4,
    });
    expect(hosted.put).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinate: { vaultId, objectId, revisionId },
        objectType: "document",
        revision: 3,
        epoch: 7,
        ciphertext: Uint8Array.from([0, 0, 0, 0]),
      }),
    );
    expect(uploaded).toEqual(Uint8Array.of(0xa4, 1, 2, 3));
    expect(encodedRevision).toEqual(new Uint8Array(4));
  });

  it("opens only after hosted and native metadata agree", async () => {
    const expectedPlaintext = Uint8Array.from(Buffer.from('{"title":"Moon"}'));
    const openedBytes = expectedPlaintext.slice();
    const opened = {
      version: 1 as const,
      suite: "anc/v1" as const,
      operation: "open_object" as const,
      state: "opened" as const,
      vaultId,
      objectId,
      revision: 3,
      epoch: 7,
      revisionId: Buffer.from(revisionId, "hex"),
      contentType:
        "application/vnd.agent-native.content-document+json" as const,
      plaintextLength: openedBytes.byteLength,
      writerEndpointId: Buffer.alloc(16, 4),
      plaintext: openedBytes,
    };
    const native = {
      sealContentObjectRevision: vi.fn(),
      openContentObjectRevision: vi.fn(async () => opened),
    };
    const hosted = transport();
    const runtime = new PrivateVaultContentObjectRuntime(native);
    await expect(
      runtime.downloadAndOpen({
        transport: hosted as never,
        vaultId,
        objectId,
        revisionId,
      }),
    ).resolves.toMatchObject({
      plaintext: expectedPlaintext,
      epoch: 7,
      writerEndpointId: "04".repeat(16),
    });
    expect(openedBytes).toEqual(new Uint8Array(openedBytes.byteLength));

    const rejectedBytes = expectedPlaintext.slice();
    native.openContentObjectRevision.mockResolvedValueOnce({
      ...opened,
      epoch: 8,
      plaintext: rejectedBytes,
    });
    await expect(
      runtime.downloadAndOpen({
        transport: hosted as never,
        vaultId,
        objectId,
        revisionId,
      }),
    ).rejects.toThrow("object binding failed");
    expect(rejectedBytes).toEqual(new Uint8Array(rejectedBytes.byteLength));
  });
});
