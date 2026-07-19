import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentObjectTransport,
  PrivateVaultContentObjectTransportError,
} from "./content-object-transport.js";

const coordinate = {
  vaultId: "10".repeat(16),
  objectId: "20".repeat(16),
  revisionId: "30".repeat(32),
};

function response(
  url: string,
  body: Uint8Array | string,
  headers: Record<string, string>,
) {
  const bytes =
    typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
  const value = new Response(bytes, {
    status: 200,
    headers: { "Content-Length": String(bytes.byteLength), ...headers },
  });
  Object.defineProperties(value, {
    url: { value: url },
    redirected: { value: false },
  });
  return value;
}

describe("Private Vault Content object transport", () => {
  it("uploads only one bounded opaque revision through the authenticated session", async () => {
    const url = "https://content.example/api/private-vault/objects";
    const metadata = {
      ...coordinate,
      objectType: "document",
      algorithmId: "anc/v1",
      revision: 3,
      epoch: 7,
      parentRevisionIds: [],
      ciphertextByteLength: 4,
      serverReceivedAt: "2026-07-18T20:00:00.000Z",
    };
    let transferred: Buffer | undefined;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      transferred = init.body as Buffer;
      return response(url, JSON.stringify(metadata), {
        "Content-Type": "application/json",
      });
    });
    const transport = new PrivateVaultContentObjectTransport({
      session: { fetch },
      origin: "https://content.example",
    });
    const source = Uint8Array.of(1, 2, 3, 4);
    await expect(
      transport.put({ coordinate, revision: 3, epoch: 7, ciphertext: source }),
    ).resolves.toEqual(metadata);
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        redirect: "error",
        headers: expect.objectContaining({
          "X-ANC-Vault-Id": coordinate.vaultId,
          "X-ANC-Object-Id": coordinate.objectId,
          "X-ANC-Revision-Id": coordinate.revisionId,
          "X-ANC-Revision": "3",
          "X-ANC-Epoch": "7",
        }),
      }),
    );
    expect(transferred).toEqual(Buffer.alloc(4));
    expect(source).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it("downloads an exact bounded ciphertext revision and rejects metadata substitution", async () => {
    const url = `https://content.example/api/private-vault/objects/${coordinate.objectId}/${coordinate.revisionId}`;
    const ciphertext = Uint8Array.of(0xa4, 1, 2, 3);
    const validHeaders = {
      "Content-Type": "application/octet-stream",
      "X-ANC-Ciphertext-Byte-Length": "4",
      "X-ANC-Revision": "3",
      "X-ANC-Epoch": "7",
      "X-ANC-Object-Type": "document",
      "X-ANC-Algorithm-Id": "anc/v1",
      "X-ANC-Parent-Revision-Ids": Buffer.from("[]").toString("base64url"),
    };
    const fetch = vi.fn(async () => response(url, ciphertext, validHeaders));
    const transport = new PrivateVaultContentObjectTransport({
      session: { fetch },
      origin: "https://content.example",
    });
    await expect(transport.get(coordinate)).resolves.toEqual({
      ciphertext,
      metadata: {
        objectType: "document",
        algorithmId: "anc/v1",
        revision: 3,
        epoch: 7,
        parentRevisionIds: [],
        ciphertextByteLength: 4,
      },
    });

    for (const headers of [
      { ...validHeaders, "X-ANC-Epoch": "0" },
      { ...validHeaders, "X-ANC-Object-Type": "page" },
      { ...validHeaders, "Content-Length": "3" },
    ]) {
      const hostile = new PrivateVaultContentObjectTransport({
        session: { fetch: async () => response(url, ciphertext, headers) },
        origin: "https://content.example",
      });
      await expect(hostile.get(coordinate)).rejects.toBeInstanceOf(
        PrivateVaultContentObjectTransportError,
      );
    }
  });

  it("lists only strictly bound content-free object coordinates", async () => {
    const url = "https://content.example/api/private-vault/objects";
    const latestRevision = {
      ...coordinate,
      objectType: "document",
      algorithmId: "anc/v1",
      revision: 3,
      epoch: 7,
      parentRevisionIds: [],
      ciphertextByteLength: 400,
      serverReceivedAt: "2026-07-18T20:00:00.000Z",
    };
    const payload = {
      objects: [
        {
          objectId: coordinate.objectId,
          objectType: "document",
          latestRevision,
        },
      ],
    };
    const fetch = vi.fn(async () =>
      response(url, JSON.stringify(payload), {
        "Content-Type": "application/json",
      }),
    );
    const transport = new PrivateVaultContentObjectTransport({
      session: { fetch },
      origin: "https://content.example",
    });
    await expect(transport.list(coordinate.vaultId)).resolves.toEqual(
      payload.objects,
    );
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-ANC-Vault-Id": coordinate.vaultId,
        }),
      }),
    );

    const hostile = new PrivateVaultContentObjectTransport({
      session: {
        fetch: async () =>
          response(
            url,
            JSON.stringify({
              objects: [
                {
                  ...payload.objects[0],
                  latestRevision: {
                    ...latestRevision,
                    objectId: "40".repeat(16),
                  },
                },
              ],
            }),
            { "Content-Type": "application/json" },
          ),
      },
      origin: "https://content.example",
    });
    await expect(hostile.list(coordinate.vaultId)).rejects.toBeInstanceOf(
      PrivateVaultContentObjectTransportError,
    );
  });

  it("fails closed on non-HTTPS origins and malformed coordinates", async () => {
    expect(
      () =>
        new PrivateVaultContentObjectTransport({
          session: { fetch: vi.fn() },
          origin: "http://content.example",
        }),
    ).toThrow(PrivateVaultContentObjectTransportError);
    const transport = new PrivateVaultContentObjectTransport({
      session: { fetch: vi.fn() },
      origin: "https://content.example",
    });
    await expect(
      transport.get({
        ...coordinate,
        objectId: coordinate.objectId.toUpperCase(),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentObjectTransportError);
  });
});
