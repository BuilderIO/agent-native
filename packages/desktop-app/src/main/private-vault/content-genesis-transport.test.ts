import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentGenesisTransport,
  PrivateVaultContentGenesisTransportError,
  type PrivateVaultContentSession,
} from "./content-genesis-transport.js";

function response(input: {
  url: string;
  body?: Uint8Array;
  type: string;
  status?: number;
  redirected?: boolean;
}): Response {
  const body = input.body ?? Uint8Array.of(9, 8, 7);
  return {
    status: input.status ?? 200,
    url: input.url,
    redirected: input.redirected ?? false,
    headers: new Headers({
      "content-type": input.type,
      "content-length": String(body.byteLength),
    }),
    arrayBuffer: async () => body.slice().buffer,
  } as Response;
}

describe("PrivateVaultContentGenesisTransport", () => {
  it("uses the exact authenticated Content session for challenge and admission", async () => {
    const fetch = vi
      .fn<PrivateVaultContentSession["fetch"]>()
      .mockResolvedValueOnce(
        response({
          url: "https://content-fork.example/api/private-vault/genesis/challenge",
          type: "application/vnd.agent-native.genesis-admission-challenge+cbor",
        }),
      )
      .mockResolvedValueOnce(
        response({
          url: "https://content-fork.example/api/private-vault/genesis/admit",
          type: "application/vnd.agent-native.genesis-admission+cbor",
        }),
      );
    const transport = new PrivateVaultContentGenesisTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await transport.issueChallenge(Uint8Array.of(1));
    await transport.admit({ body: Uint8Array.of(2), proofHeader: "abc_123" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://content-fork.example/api/private-vault/genesis/challenge",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "include",
        headers: expect.objectContaining({
          Origin: "https://content-fork.example",
          "X-Agent-Native-CSRF": "1",
          "Content-Length": "1",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://content-fork.example/api/private-vault/genesis/admit",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "X-ANC-Endpoint-Request-Proof": "abc_123",
        }),
      }),
    );
  });

  it("sends append without ambient browser credentials", async () => {
    const fetch = vi.fn<PrivateVaultContentSession["fetch"]>();
    fetch.mockResolvedValue(
      response({
        url: "https://content-fork.example/api/private-vault/control-log/append",
        type: "application/vnd.agent-native.control-log+cbor",
      }),
    );
    const transport = new PrivateVaultContentGenesisTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await transport.appendGenesis({
      body: Uint8Array.of(3),
      proofHeader: "append-proof",
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: "omit",
        headers: expect.not.objectContaining({
          "X-Agent-Native-CSRF": expect.anything(),
        }),
      }),
    );
  });

  it("rejects redirects, response confusion, malformed proof, and non-HTTPS origins", async () => {
    const fetch = vi.fn<PrivateVaultContentSession["fetch"]>();
    fetch.mockResolvedValue(
      response({
        url: "https://evil.example/challenge",
        type: "application/octet-stream",
        redirected: true,
      }),
    );
    const transport = new PrivateVaultContentGenesisTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(transport.issueChallenge(Uint8Array.of(1))).rejects.toEqual(
      new PrivateVaultContentGenesisTransportError(),
    );
    await expect(
      transport.admit({ body: Uint8Array.of(1), proofHeader: "not valid" }),
    ).rejects.toBeInstanceOf(PrivateVaultContentGenesisTransportError);
    expect(
      () =>
        new PrivateVaultContentGenesisTransport({
          session: { fetch },
          origin: "http://content-fork.example",
        }),
    ).toThrow(PrivateVaultContentGenesisTransportError);
  });
});
