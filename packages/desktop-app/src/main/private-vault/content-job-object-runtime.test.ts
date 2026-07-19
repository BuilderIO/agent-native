import { describe, expect, it, vi } from "vitest";

import { PrivateVaultContentJobObjectRuntime } from "./content-job-object-runtime.js";

const vaultId = "10".repeat(16);
const objectId = "20".repeat(16);
const revisionId = "30".repeat(32);
const context = { jobId: "40".repeat(16), jobHash: "50".repeat(32) };

describe("Private Vault broker Content object runtime", () => {
  it("carries the exact claimed job through seal and open bindings", async () => {
    const encodedRevision = Uint8Array.of(0xa4, 1, 2, 3);
    const plaintext = Uint8Array.from(Buffer.from('{"title":"Moon"}'));
    const openedBytes = plaintext.slice();
    const native = {
      sealJobContentObjectRevision: vi.fn(async (input) => ({
        version: 1 as const,
        suite: "anc/v1" as const,
        operation: "seal_job_object" as const,
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
      openJobContentObjectRevision: vi.fn(async () => ({
        version: 1 as const,
        suite: "anc/v1" as const,
        operation: "open_job_object" as const,
        state: "opened" as const,
        vaultId,
        objectId,
        revision: 3,
        epoch: 7,
        revisionId: Buffer.from(revisionId, "hex"),
        contentType:
          "application/vnd.agent-native.content-document+json" as const,
        plaintextLength: plaintext.byteLength,
        writerEndpointId: Buffer.alloc(16, 8),
        plaintext: openedBytes,
      })),
    };
    const transport = {
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
    const runtime = new PrivateVaultContentJobObjectRuntime(native);

    await runtime.sealAndUpload({
      context,
      transport: transport as never,
      vaultId,
      objectId,
      revision: 3,
      plaintext,
    });
    await expect(
      runtime.downloadAndOpen({
        context,
        transport: transport as never,
        vaultId,
        objectId,
        revisionId,
      }),
    ).resolves.toMatchObject({ plaintext });
    expect(native.sealJobContentObjectRevision).toHaveBeenCalledWith(
      expect.objectContaining(context),
    );
    expect(native.openJobContentObjectRevision).toHaveBeenCalledWith(
      expect.objectContaining(context),
    );
    expect(encodedRevision).toEqual(new Uint8Array(4));
    expect(openedBytes).toEqual(new Uint8Array(openedBytes.byteLength));
  });
});
