import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRequesterTransport,
  PrivateVaultContentRequesterTransportError,
} from "./content-requester-transport.js";

const vaultId = "00112233445566778899aabbccddeeff";
const grantId = "11112222333344445555666677778888";
const jobId = "ffeeddccbbaa99887766554433221100";
const recipientEndpointId = "9999aaaabbbbccccddddeeeeffff0000";
const issuedAt = "2026-07-18T12:00:00.000Z";
const expiresAt = "2026-07-18T12:10:00.000Z";

function jsonResponse(url: string, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return {
    ok: true,
    url,
    redirected: false,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(body.byteLength),
    }),
    arrayBuffer: async () => body,
  } as unknown as Response;
}

describe("Content requester transport", () => {
  it("uploads opaque grant and job bytes with exact hosted coordinates", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/grants")
        ? jsonResponse(url, {
            vaultId,
            grantId,
            recipientEndpointId,
            algorithmId: "anc/v1",
            ciphertextByteLength: 3,
            issuedAt,
            expiresAt,
            serverReceivedAt: issuedAt,
          })
        : jsonResponse(url, {
            vaultId,
            jobId,
            grantId,
            recipientEndpointId,
            epoch: 2,
            algorithmId: "anc/v1",
            ciphertextByteLength: 3,
            issuedAt,
            expiresAt,
            state: "queued",
            retryCount: 0,
          }),
    );
    const transport = new PrivateVaultContentRequesterTransport({
      origin: "https://content.example.test",
      session: { fetch },
    });
    await transport.putGrant({
      vaultId,
      grantId,
      recipientEndpointId,
      issuedAt,
      expiresAt,
      ciphertext: Uint8Array.from([1, 2, 3]),
    });
    await transport.putJob({
      vaultId,
      jobId,
      grantId,
      recipientEndpointId,
      epoch: 2,
      issuedAt,
      expiresAt,
      ciphertext: Uint8Array.from([4, 5, 6]),
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://content.example.test/api/private-vault/grants",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "include",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://content.example.test/api/private-vault/jobs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("downloads only an exact bounded encrypted result", async () => {
    const url = `https://content.example.test/api/private-vault/jobs/${jobId}/result`;
    const ciphertext = Buffer.from([7, 8, 9]);
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          url,
          redirected: false,
          headers: new Headers({
            "content-type": "application/octet-stream",
            "content-length": "3",
            "x-anc-job-state": "completed",
            "x-anc-epoch": "2",
            "x-anc-job-hash": "ab".repeat(32),
            "x-anc-algorithm-id": "anc/v1",
          }),
          arrayBuffer: async () => ciphertext,
        }) as unknown as Response,
    );
    const transport = new PrivateVaultContentRequesterTransport({
      origin: "https://content.example.test",
      session: { fetch },
    });
    await expect(
      transport.getResult({ vaultId, jobId }),
    ).resolves.toMatchObject({
      state: "completed",
      epoch: 2,
      jobHash: "ab".repeat(32),
    });
    fetch.mockResolvedValueOnce({
      ...(await fetch()),
      url: "https://evil.example/result",
    } as Response);
    await expect(transport.getResult({ vaultId, jobId })).rejects.toEqual(
      new PrivateVaultContentRequesterTransportError(),
    );
  });

  it("revokes an opaque grant through its authenticated coordinate", async () => {
    const url = `https://content.example.test/api/private-vault/grants/${grantId}`;
    const fetch = vi.fn(async () =>
      jsonResponse(url, { vaultId, grantId, state: "revoked" }),
    );
    const transport = new PrivateVaultContentRequesterTransport({
      origin: "https://content.example.test",
      session: { fetch },
    });
    await expect(transport.revokeGrant({ vaultId, grantId })).resolves.toEqual({
      vaultId,
      grantId,
      state: "revoked",
    });
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("preserves a hosted not-found status for bounded result polling", async () => {
    const fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          url: `https://content.example.test/api/private-vault/jobs/${jobId}/result`,
          redirected: false,
          headers: new Headers(),
        }) as unknown as Response,
    );
    const transport = new PrivateVaultContentRequesterTransport({
      origin: "https://content.example.test",
      session: { fetch },
    });
    await expect(transport.getResult({ vaultId, jobId })).rejects.toEqual(
      new PrivateVaultContentRequesterTransportError(404),
    );
  });
});
