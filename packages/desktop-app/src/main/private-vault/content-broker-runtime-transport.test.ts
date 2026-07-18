import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentBrokerRuntimeTransport,
  PrivateVaultContentBrokerRuntimeTransportError,
} from "./content-broker-runtime-transport.js";

const descriptor = {
  version: 1,
  suite: "anc/v1",
  state: "active",
  vaultId: "00112233445566778899aabbccddeeff",
  endpointId: "11112222333344445555666677778888",
  head: { sequence: 7, hash: "ab".repeat(32) },
} as const;

function response(value: unknown = descriptor, mutation = {}) {
  const body = JSON.stringify(value);
  return {
    status: 200,
    url: "https://content.example.test/api/private-vault/broker/runtime",
    redirected: false,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    }),
    arrayBuffer: async () => Buffer.from(body),
    ...mutation,
  } as unknown as Response;
}

describe("Content broker runtime transport", () => {
  it("reads only the current session's exact content-free descriptor", async () => {
    const fetch = vi.fn(async () => response());
    const transport = new PrivateVaultContentBrokerRuntimeTransport({
      origin: "https://content.example.test",
      session: { fetch },
    });
    await expect(transport.read()).resolves.toEqual(descriptor);
    expect(fetch).toHaveBeenCalledWith(
      "https://content.example.test/api/private-vault/broker/runtime",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
      }),
    );
  });

  it("rejects redirects, substitutions, extra fields, and unbounded bodies", async () => {
    for (const candidate of [
      response(descriptor, { redirected: true }),
      response(descriptor, { url: "https://evil.test/runtime" }),
      response({ ...descriptor, secret: "no" }),
      response(descriptor, {
        headers: new Headers({
          "content-type": "application/json",
          "content-length": "99999",
        }),
      }),
    ]) {
      const transport = new PrivateVaultContentBrokerRuntimeTransport({
        origin: "https://content.example.test",
        session: { fetch: vi.fn(async () => candidate) },
      });
      await expect(transport.read()).rejects.toEqual(
        new PrivateVaultContentBrokerRuntimeTransportError(),
      );
    }
  });
});
