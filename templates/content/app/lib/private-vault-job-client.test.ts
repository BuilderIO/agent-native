import { afterEach, describe, expect, it, vi } from "vitest";

import { readBoundedResponseBytes } from "./private-vault-bounded-response.js";
import {
  getPrivateVaultJobResult,
  PrivateVaultJobTransportError,
  uploadPrivateVaultJob,
} from "./private-vault-job-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("Private Vault named job client", () => {
  const uploadResponse = {
    vaultId: "vault:test",
    jobId: "job:test",
    grantId: "grant:test",
    recipientEndpointId: "endpoint:test",
    epoch: 1,
    algorithmId: "anc/v1",
    ciphertextByteLength: 3,
    issuedAt: "2026-07-16T12:00:00.000Z",
    expiresAt: "2026-07-16T13:00:00.000Z",
    state: "queued",
    retryCount: 0,
    retryAt: null,
    leaseExpiresAt: null,
    serverReceivedAt: "2026-07-16T12:00:00.000Z",
  };

  it("uploads only octet-stream ciphertext with explicit opaque metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(uploadResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await uploadPrivateVaultJob({
      vaultId: "vault:test",
      jobId: "job:test",
      grantId: "grant:test",
      recipientEndpointId: "endpoint:test",
      epoch: 1,
      algorithmId: "anc/v1",
      issuedAt: "2026-07-16T12:00:00.000Z",
      expiresAt: "2026-07-16T13:00:00.000Z",
      ciphertext: Uint8Array.from([1, 2, 3]),
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/private-vault/jobs"),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/octet-stream",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Ciphertext-Byte-Length": "3",
        }),
      }),
    );
  });

  it.each([
    ["cross-job", { ...uploadResponse, jobId: "job:other" }],
    [
      "cross-endpoint",
      { ...uploadResponse, recipientEndpointId: "endpoint:other" },
    ],
    ["wrong-suite", { ...uploadResponse, algorithmId: "anc/v2" }],
    ["extra-field", { ...uploadResponse, prompt: "please leak this" }],
    ["bad-id", { ...uploadResponse, grantId: "bad id" }],
  ])("rejects malicious job relay JSON: %s", async (_name, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      uploadPrivateVaultJob({
        vaultId: "vault:test",
        jobId: "job:test",
        grantId: "grant:test",
        recipientEndpointId: "endpoint:test",
        epoch: 1,
        algorithmId: "anc/v1",
        issuedAt: "2026-07-16T12:00:00.000Z",
        expiresAt: "2026-07-16T13:00:00.000Z",
        ciphertext: Uint8Array.from([1, 2, 3]),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultJobTransportError);
  });

  it("rejects malformed result metadata even when the response is successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([1, 2]), {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "x-anc-ciphertext-byte-length": "2",
            "x-anc-algorithm-id": "anc/v1",
            "x-anc-epoch": "1",
            "x-anc-job-state": "completed",
          },
        }),
      ),
    );
    await expect(
      getPrivateVaultJobResult({ vaultId: "vault:test", jobId: "job:test" }),
    ).rejects.toBeInstanceOf(PrivateVaultJobTransportError);
  });

  it("rejects malformed content-length before consuming result bytes", async () => {
    let pulls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
              "content-length": String(16 * 1024 * 1024 + 1),
              "x-anc-ciphertext-byte-length": "3",
              "x-anc-algorithm-id": "anc/v1",
              "x-anc-epoch": "1",
              "x-anc-job-state": "completed",
              "x-anc-job-hash": "hash:test",
            },
          },
        ),
      ),
    );
    await expect(
      getPrivateVaultJobResult({ vaultId: "vault:test", jobId: "job:test" }),
    ).rejects.toBeInstanceOf(PrivateVaultJobTransportError);
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it("cancels a stream as soon as actual bytes exceed the ceiling", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.enqueue(Uint8Array.from([3, 4]));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(
      readBoundedResponseBytes(response, {
        maximumByteLength: 3,
        expectedByteLength: 3,
        invalidResponse: () => new PrivateVaultJobTransportError(502),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultJobTransportError);
    expect(cancelled).toBe(true);
  });
});
