import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deletePrivateVaultCiphertextObject,
  getPrivateVaultCiphertextRevision,
  listPrivateVaultCiphertextObjects,
  PrivateVaultTransportError,
  uploadPrivateVaultCiphertextRevision,
} from "./private-vault-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Private Vault named ciphertext client", () => {
  const uploadResponse = {
    vaultId: "vault:test-0001",
    objectId: "object:test-0001",
    revisionId: "revision:test-0001",
    objectType: "document",
    algorithmId: "anc/v1",
    epoch: 1,
    parentRevisionIds: [],
    ciphertextByteLength: 3,
    serverReceivedAt: "2026-07-16T12:00:00.000Z",
  };

  it("owns the raw binary upload and sends only opaque protocol headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(uploadResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ciphertext = new Uint8Array([1, 2, 3]);

    await uploadPrivateVaultCiphertextRevision({
      vaultId: "vault:test-0001",
      objectId: "object:test-0001",
      revisionId: "revision:test-0001",
      objectType: "document",
      algorithmId: "anc/v1",
      epoch: 1,
      ciphertext,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/private-vault/objects"),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: expect.any(ArrayBuffer),
        headers: expect.objectContaining({
          "Content-Type": "application/octet-stream",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Ciphertext-Byte-Length": "3",
        }),
      }),
    );
  });

  it.each([
    ["cross-vault", { ...uploadResponse, vaultId: "vault:other-0001" }],
    ["unknown-field", { ...uploadResponse, plaintext: "surprise" }],
    ["wrong-suite", { ...uploadResponse, algorithmId: "anc/v2" }],
    ["malformed-id", { ...uploadResponse, objectId: "bad id" }],
    [
      "too-many-parents",
      {
        ...uploadResponse,
        parentRevisionIds: Array.from(
          { length: 33 },
          (_, index) => `parent:${index.toString().padStart(4, "0")}`,
        ),
      },
    ],
  ])("rejects malicious upload metadata: %s", async (_name, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      uploadPrivateVaultCiphertextRevision({
        vaultId: "vault:test-0001",
        objectId: "object:test-0001",
        revisionId: "revision:test-0001",
        objectType: "document",
        algorithmId: "anc/v1",
        epoch: 1,
        ciphertext: Uint8Array.from([1, 2, 3]),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultTransportError);
  });

  it("round-trips exact ciphertext and strict response metadata", async () => {
    const ciphertext = new Uint8Array([7, 8, 9]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(ciphertext, {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "x-anc-ciphertext-byte-length": "3",
              "x-anc-algorithm-id": "anc/v1",
              "x-anc-epoch": "2",
              "x-anc-object-type": "document",
              "x-anc-parent-revision-ids": "W10",
            },
          }),
      ),
    );
    const result = await getPrivateVaultCiphertextRevision({
      vaultId: "vault:test-0001",
      objectId: "object:test-0001",
      revisionId: "revision:test-0001",
    });
    expect(result.ciphertext).toEqual(ciphertext);
    expect(result.metadata).toMatchObject({
      algorithmId: "anc/v1",
      epoch: 2,
      ciphertextByteLength: 3,
      parentRevisionIds: [],
    });
  });

  it("rejects malformed response length without reading an error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "x-anc-ciphertext-byte-length": "2",
              "x-anc-algorithm-id": "anc/v1",
              "x-anc-epoch": "1",
              "x-anc-object-type": "document",
              "x-anc-parent-revision-ids": "W10",
            },
          }),
      ),
    );
    await expect(
      getPrivateVaultCiphertextRevision({
        vaultId: "vault:test-0001",
        objectId: "object:test-0001",
        revisionId: "revision:test-0001",
      }),
    ).rejects.toBeInstanceOf(PrivateVaultTransportError);
  });

  it("rejects an oversized declared body before reading its stream", async () => {
    let pulls = 0;
    const response = new Response(
      new ReadableStream({
        pull() {
          pulls += 1;
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(256 * 1024 * 1024 + 1),
          "x-anc-ciphertext-byte-length": "3",
          "x-anc-algorithm-id": "anc/v1",
          "x-anc-epoch": "1",
          "x-anc-object-type": "document",
          "x-anc-parent-revision-ids": "W10",
        },
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      getPrivateVaultCiphertextRevision({
        vaultId: "vault:test-0001",
        objectId: "object:test-0001",
        revisionId: "revision:test-0001",
      }),
    ).rejects.toBeInstanceOf(PrivateVaultTransportError);
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("rejects malformed encrypted response headers before reading the body", async () => {
    let pulls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull() {
                pulls += 1;
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/octet-stream",
                "x-anc-ciphertext-byte-length": "3",
                "x-anc-algorithm-id": "anc/v2",
                "x-anc-epoch": "1",
                "x-anc-object-type": "document",
                "x-anc-parent-revision-ids": "not-base64-json",
              },
            },
          ),
      ),
    );
    await expect(
      getPrivateVaultCiphertextRevision({
        vaultId: "vault:test-0001",
        objectId: "object:test-0001",
        revisionId: "revision:test-0001",
      }),
    ).rejects.toBeInstanceOf(PrivateVaultTransportError);
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("lists only strictly bound content-free object coordinates", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            objects: [
              {
                objectId: uploadResponse.objectId,
                objectType: uploadResponse.objectType,
                latestRevision: uploadResponse,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listPrivateVaultCiphertextObjects({ vaultId: uploadResponse.vaultId }),
    ).resolves.toEqual([
      expect.objectContaining({ objectId: uploadResponse.objectId }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/private-vault/objects"),
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        headers: { "X-ANC-Vault-Id": uploadResponse.vaultId },
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              objects: [
                {
                  objectId: uploadResponse.objectId,
                  objectType: uploadResponse.objectType,
                  latestRevision: {
                    ...uploadResponse,
                    objectId: "object:substituted-0001",
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      listPrivateVaultCiphertextObjects({ vaultId: uploadResponse.vaultId }),
    ).rejects.toBeInstanceOf(PrivateVaultTransportError);
  });

  it("uses the named delete helper with CSRF and vault scope", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await deletePrivateVaultCiphertextObject({
      vaultId: "vault:test-0001",
      objectId: "object:test-0001",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/object%3Atest-0001"),
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": "vault:test-0001",
        }),
      }),
    );
  });
});
