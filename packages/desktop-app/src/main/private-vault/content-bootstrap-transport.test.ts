import {
  decodeAncV1VaultBootstrapResponse,
  encodeAncV1VaultBootstrapResponse,
  type AncV1VaultBootstrapRequest,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentBootstrapTransport,
  PrivateVaultContentBootstrapTransportError,
} from "./content-bootstrap-transport.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const vaultId = "vault-bootstrap-0001";
const head = { sequence: 0, hash: "ab".repeat(32) };
const initial: AncV1VaultBootstrapRequest = {
  version: 1,
  suite: "anc/v1",
  type: "vault-bootstrap-request",
  afterSequence: -1,
  expectedHead: null,
};

function encodedPage(options: {
  afterSequence?: number;
  head?: { sequence: number; hash: string };
}) {
  const responseHead = options.head ?? head;
  const afterSequence = options.afterSequence ?? -1;
  return encodeAncV1VaultBootstrapResponse({
    metadata: {
      version: 1,
      suite: "anc/v1",
      type: "vault-bootstrap-response",
      vaultId,
      afterSequence,
      throughSequence: responseHead.sequence,
      head: responseHead,
      complete: true,
      recoveryWrapHash: "cd".repeat(32),
    },
    entries: afterSequence < responseHead.sequence ? [Uint8Array.of(1, 2)] : [],
    entryRecoveryWraps:
      afterSequence < responseHead.sequence ? [Uint8Array.of(7)] : [],
    recoveryWrap: Uint8Array.of(3, 4),
  });
}

function response(input: {
  body?: Uint8Array;
  url?: string;
  status?: number;
  redirected?: boolean;
  contentType?: string | null;
  contentLength?: string | null;
}): Response {
  const body = input.body ?? encodedPage({});
  const headers = new Headers();
  if (input.contentType !== null) {
    headers.set(
      "content-type",
      input.contentType ?? "application/octet-stream",
    );
  }
  if (input.contentLength !== null) {
    headers.set(
      "content-length",
      input.contentLength ?? String(body.byteLength),
    );
  }
  return {
    status: input.status ?? 200,
    url:
      input.url ?? "https://content-fork.example/api/private-vault/bootstrap",
    redirected: input.redirected ?? false,
    headers,
    arrayBuffer: async () => body.slice().buffer,
  } as Response;
}

describe("PrivateVaultContentBootstrapTransport", () => {
  it("fetches one account-scoped page through the authenticated Content session", async () => {
    const fetch = vi.fn<PrivateVaultContentSession["fetch"]>();
    fetch.mockResolvedValue(response({}));
    const transport = new PrivateVaultContentBootstrapTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    const page = await transport.fetchPage(initial);
    expect(page.metadata).toMatchObject({
      vaultId,
      afterSequence: -1,
      head,
      complete: true,
    });
    expect(page.recoveryWrap).toEqual(Uint8Array.of(3, 4));
    expect(fetch).toHaveBeenCalledWith(
      "https://content-fork.example/api/private-vault/bootstrap",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: expect.objectContaining({
          Origin: "https://content-fork.example",
          "X-Agent-Native-CSRF": "1",
          "Content-Type": "application/octet-stream",
        }),
      }),
    );
  });

  it("streams every page to a replaying native consumer under one pinned head", async () => {
    const pinned = { sequence: 8, hash: "ef".repeat(32) };
    const first = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: -1,
        throughSequence: 7,
        head: pinned,
        complete: false,
        recoveryWrapHash: null,
      },
      entries: Array.from({ length: 8 }, () => Uint8Array.of(1)),
      entryRecoveryWraps: Array.from({ length: 8 }, () => null),
      recoveryWrap: null,
    });
    const final = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: 7,
        throughSequence: 8,
        head: pinned,
        complete: true,
        recoveryWrapHash: "cd".repeat(32),
      },
      entries: [Uint8Array.of(2)],
      entryRecoveryWraps: [Uint8Array.of(4)],
      recoveryWrap: Uint8Array.of(3),
    });
    const fetch = vi
      .fn<PrivateVaultContentSession["fetch"]>()
      .mockResolvedValueOnce(response({ body: first }))
      .mockResolvedValueOnce(response({ body: final }));
    const acceptedFrames: Uint8Array[] = [];
    const acceptPage = vi.fn(async (encoded: Uint8Array) => {
      acceptedFrames.push(Uint8Array.from(encoded));
      const page = decodeAncV1VaultBootstrapResponse(encoded);
      return {
        vaultId: page.metadata.vaultId,
        throughSequence: page.metadata.throughSequence,
        head: page.metadata.head,
        complete: page.metadata.complete,
      };
    });
    const transport = new PrivateVaultContentBootstrapTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(transport.transfer({ acceptPage })).resolves.toEqual({
      vaultId,
      throughSequence: 8,
      head: pinned,
      complete: true,
    });
    expect(acceptedFrames).toEqual([first, final]);
    const secondRequest = JSON.parse(
      Buffer.from(
        (fetch.mock.calls[1]![1] as RequestInit).body as Uint8Array,
      ).toString("utf8"),
    );
    expect(secondRequest).toMatchObject({
      afterSequence: 7,
      expectedHead: pinned,
    });
  });

  it("rejects native acknowledgement substitution before fetching another page", async () => {
    const pinned = { sequence: 8, hash: "ef".repeat(32) };
    const first = encodeAncV1VaultBootstrapResponse({
      metadata: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-response",
        vaultId,
        afterSequence: -1,
        throughSequence: 7,
        head: pinned,
        complete: false,
        recoveryWrapHash: null,
      },
      entries: Array.from({ length: 8 }, () => Uint8Array.of(1)),
      entryRecoveryWraps: Array.from({ length: 8 }, () => null),
      recoveryWrap: null,
    });
    const fetch = vi.fn<PrivateVaultContentSession["fetch"]>();
    fetch.mockResolvedValue(response({ body: first }));
    const transport = new PrivateVaultContentBootstrapTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(
      transport.transfer({
        acceptPage: async () => ({
          vaultId,
          throughSequence: 6,
          head: pinned,
          complete: false,
        }),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentBootstrapTransportError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires every continuation response to match the pinned head and cursor", async () => {
    const request: AncV1VaultBootstrapRequest = {
      ...initial,
      afterSequence: 0,
      expectedHead: { sequence: 1, hash: "aa".repeat(32) },
    };
    const fetch = vi.fn<PrivateVaultContentSession["fetch"]>();
    fetch.mockResolvedValue(
      response({
        body: encodedPage({
          afterSequence: 0,
          head: { sequence: 1, hash: "bb".repeat(32) },
        }),
      }),
    );
    const transport = new PrivateVaultContentBootstrapTransport({
      session: { fetch },
      origin: "https://content-fork.example",
    });
    await expect(transport.fetchPage(request)).rejects.toBeInstanceOf(
      PrivateVaultContentBootstrapTransportError,
    );
  });

  it("rejects redirects, response confusion, bad lengths, and non-HTTPS origins", async () => {
    const badResponses = [
      response({ redirected: true }),
      response({ url: "https://evil.example/bootstrap" }),
      response({ contentType: "application/json" }),
      response({ contentLength: "01" }),
      response({ contentLength: null }),
    ];
    for (const badResponse of badResponses) {
      const transport = new PrivateVaultContentBootstrapTransport({
        session: { fetch: async () => badResponse },
        origin: "https://content-fork.example",
      });
      await expect(transport.fetchPage(initial)).rejects.toBeInstanceOf(
        PrivateVaultContentBootstrapTransportError,
      );
    }
    expect(
      () =>
        new PrivateVaultContentBootstrapTransport({
          session: { fetch: async () => response({}) },
          origin: "http://content-fork.example",
        }),
    ).toThrow(PrivateVaultContentBootstrapTransportError);
  });
});
