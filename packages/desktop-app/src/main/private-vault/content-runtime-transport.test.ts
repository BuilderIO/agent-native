import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRuntimeTransport,
  PrivateVaultContentRuntimeTransportError,
} from "./content-runtime-transport.js";

const value = {
  version: 1,
  suite: "anc/v1",
  state: "active",
  vaultId: "11".repeat(16),
  head: { sequence: 7, hash: "22".repeat(32) },
} as const;

function response(bodyValue: unknown = value, mutation = {}) {
  const body = JSON.stringify(bodyValue);
  return {
    status: 200,
    url: "https://content.example.test/api/private-vault/runtime",
    redirected: false,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    arrayBuffer: async () => Buffer.from(body),
    ...mutation,
  } as unknown as Response;
}

describe("Private Content runtime transport", () => {
  it("discovers attended vault custody without a broker coordinate", async () => {
    const fetch = vi.fn(async () => response());
    await expect(
      new PrivateVaultContentRuntimeTransport({
        origin: "https://content.example.test",
        session: { fetch },
      }).read(),
    ).resolves.toEqual(value);
    expect(fetch).toHaveBeenCalledWith(
      "https://content.example.test/api/private-vault/runtime",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("rejects redirects and descriptor substitution", async () => {
    for (const candidate of [
      response(value, { redirected: true }),
      response({ ...value, endpointId: "33".repeat(16) }),
      response(value, { url: "https://evil.test/runtime" }),
    ]) {
      await expect(
        new PrivateVaultContentRuntimeTransport({
          origin: "https://content.example.test",
          session: { fetch: async () => candidate },
        }).read(),
      ).rejects.toEqual(new PrivateVaultContentRuntimeTransportError());
    }
  });
});
