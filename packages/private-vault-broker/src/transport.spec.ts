import {
  createEndpointRequestProof,
  verifyEndpointRequestProof,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import { SodiumNativeAncV1CryptoProvider } from "./crypto/sodium-native.js";
import {
  ANC_ENDPOINT_PROOF_HEADER,
  BROKER_CONTROL_RESPONSE_MAX_BYTES,
  BROKER_JOB_PATHS,
  BROKER_REQUEST_MAX_BYTES,
  BrokerTransportError,
  SignedHostedBrokerTransport,
  createNativeEndpointRequestProof,
  decodeEndpointProofHeader,
  encodeEndpointProofHeader,
  type BrokerFetch,
  type BrokerFetchResponse,
  type EndpointRequestSigner,
} from "./transport.js";

const encoder = new TextEncoder();
const crypto = new SodiumNativeAncV1CryptoProvider();
const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const pair = crypto.signingKeypairFromSeed(seed);
const signer: EndpointRequestSigner = {
  async signEndpointRequest(payload) {
    return crypto.signDetached("endpoint-request", payload, pair.privateKey);
  },
};

class SequentialNonceCrypto extends SodiumNativeAncV1CryptoProvider {
  #next = 1;

  override randomBytes(length: number): Uint8Array {
    return new Uint8Array(length).fill(this.#next++);
  }
}

function response(
  body = new Uint8Array(),
  options: {
    ok?: boolean;
    contentType?: string | null;
    contentLength?: string | null;
    chunkBytes?: number;
  } = {},
): BrokerFetchResponse {
  const chunkBytes = options.chunkBytes ?? Math.max(1, body.byteLength);
  let offset = 0;
  return {
    ok: options.ok ?? true,
    headers: {
      get(name) {
        const normalized = name.toLowerCase();
        if (normalized === "content-type") {
          return options.contentType === undefined
            ? "application/octet-stream"
            : options.contentType;
        }
        if (normalized === "content-length") {
          return options.contentLength === undefined
            ? String(body.byteLength)
            : options.contentLength;
        }
        return null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (offset >= body.byteLength) return { done: true as const };
            const value = body.slice(offset, offset + chunkBytes);
            offset += value.byteLength;
            return { done: false as const, value };
          },
          async cancel() {},
        };
      },
    },
  };
}

function transport(fetch: BrokerFetch, native = crypto) {
  return new SignedHostedBrokerTransport({
    baseUrl: "https://vault.example.test",
    vaultId: "vault-transport-0001",
    endpointId: "endpoint-transport-0001",
    signer,
    crypto: native,
    fetch,
    now: () => new Date("2026-07-17T01:00:00.000Z"),
  });
}

describe("signed hosted broker transport", () => {
  it("uses five literal POST routes, exact raw bodies, and fresh nonces", async () => {
    const calls: Array<{
      url: string;
      init: Parameters<BrokerFetch>[1];
    }> = [];
    const fetch: BrokerFetch = vi.fn(async (url, init) => {
      calls.push({ url, init: { ...init, body: Uint8Array.from(init.body) } });
      return response(encoder.encode("ok"));
    });
    const client = transport(fetch, new SequentialNonceCrypto());
    const methods = [
      ["claim", BROKER_JOB_PATHS.claim],
      ["request", BROKER_JOB_PATHS.request],
      ["ack", BROKER_JOB_PATHS.ack],
      ["retry", BROKER_JOB_PATHS.retry],
      ["result", BROKER_JOB_PATHS.result],
    ] as const;

    for (const [method] of methods) {
      const body = encoder.encode(`opaque-${method}`);
      await expect(client[method](body)).resolves.toEqual(encoder.encode("ok"));
      expect(calls.at(-1)?.init.body).toEqual(body);
    }

    const nonces = calls.map(({ url, init }, index) => {
      expect(init.method).toBe("POST");
      expect(url).toBe(`https://vault.example.test${methods[index]?.[1]}`);
      expect(init.redirect).toBe("error");
      expect(init.credentials).toBe("omit");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers["Content-Type"]).toBe("application/octet-stream");
      const proof = decodeEndpointProofHeader(
        init.headers[ANC_ENDPOINT_PROOF_HEADER]!,
      );
      expect(proof.path).toBe(methods[index]?.[1]);
      expect(proof.method).toBe("POST");
      expect(proof.nonce).toMatch(/^[0-9a-f]{32}$/);
      return proof.nonce;
    });
    expect(new Set(nonces).size).toBe(nonces.length);
    expect(nonces).toEqual(
      [1, 2, 3, 4, 5].map((byte) =>
        byte.toString(16).padStart(2, "0").repeat(16),
      ),
    );
  });

  it("matches Core proof creation exactly while signing natively", async () => {
    const body = encoder.encode('{"opaque":"job"}');
    const input = {
      vaultId: "vault-transport-0001",
      endpointId: "endpoint-transport-0001",
      path: BROKER_JOB_PATHS.claim,
      body,
      issuedAt: "2026-07-17T01:00:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
    } as const;
    const nativeProof = await createNativeEndpointRequestProof({
      ...input,
      signer,
      crypto,
    });
    const coreProof = await createEndpointRequestProof({
      ...input,
      method: "POST",
      signingPrivateKey: pair.privateKey,
    });
    expect(nativeProof).toEqual(coreProof);
  });

  it("binds proofs against cross-route and cross-body replay", async () => {
    const calls: Parameters<BrokerFetch>[1][] = [];
    const fetch: BrokerFetch = vi.fn(async (_url, init) => {
      calls.push({ ...init, body: Uint8Array.from(init.body) });
      return response();
    });
    const body = encoder.encode("opaque-claim");
    await transport(fetch).claim(body);
    const proof = decodeEndpointProofHeader(
      calls[0]!.headers[ANC_ENDPOINT_PROOF_HEADER]!,
    );
    const verify = (expectedPath: string, expectedBody: Uint8Array) =>
      verifyEndpointRequestProof({
        proof,
        expectedMethod: "POST",
        expectedPath,
        body: expectedBody,
        now: new Date("2026-07-17T01:00:01.000Z"),
        resolveAuthorizedEndpoint: async () => ({
          vaultId: "vault-transport-0001",
          endpointId: "endpoint-transport-0001",
          role: "broker",
          state: "active",
          signingPublicKey: pair.publicKey,
          authenticatedControlHead: {
            sequence: 1,
            hash: "ab".repeat(32),
            signedAt: "2026-07-17T00:59:59.000Z",
            freshnessMode: "endpoint_witnessed",
          },
        }),
        claimNonce: async () => true,
      });

    await expect(verify(BROKER_JOB_PATHS.claim, body)).resolves.toEqual({
      vaultId: "vault-transport-0001",
      endpointId: "endpoint-transport-0001",
    });
    await expect(verify(BROKER_JOB_PATHS.ack, body)).rejects.toMatchObject({
      code: "request_mismatch",
    });
    await expect(
      verify(BROKER_JOB_PATHS.claim, encoder.encode("different")),
    ).rejects.toMatchObject({ code: "request_mismatch" });
  });

  it("accepts only canonical unpadded base64url strict proof JSON", async () => {
    const proof = await createNativeEndpointRequestProof({
      vaultId: "vault-transport-0001",
      endpointId: "endpoint-transport-0001",
      path: BROKER_JOB_PATHS.claim,
      body: new Uint8Array(),
      issuedAt: "2026-07-17T01:00:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
      signer,
      crypto,
    });
    const encoded = encodeEndpointProofHeader(proof);
    expect(decodeEndpointProofHeader(encoded)).toEqual(proof);
    expect(() => decodeEndpointProofHeader(`${encoded}=`)).toThrow(
      BrokerTransportError,
    );
    expect(() =>
      decodeEndpointProofHeader(
        Buffer.from(JSON.stringify(proof, null, 2)).toString("base64url"),
      ),
    ).toThrow(BrokerTransportError);
  });

  it("bounds declared and streamed responses and exposes content-free errors", async () => {
    const declared = transport(async () =>
      response(new Uint8Array(), {
        contentLength: String(BROKER_CONTROL_RESPONSE_MAX_BYTES + 1),
      }),
    );
    await expect(declared.ack(new Uint8Array())).rejects.toMatchObject({
      code: "response_too_large",
      message: "Broker transport request failed",
    });

    const streamed = transport(async () =>
      response(new Uint8Array(BROKER_CONTROL_RESPONSE_MAX_BYTES + 1), {
        contentLength: null,
        chunkBytes: 1024,
      }),
    );
    await expect(streamed.retry(new Uint8Array())).rejects.toMatchObject({
      code: "response_too_large",
    });

    const serverText = "private server diagnostic must not escape";
    const rejected = transport(async () =>
      response(encoder.encode(serverText), { ok: false }),
    );
    const error = await rejected
      .result(new Uint8Array())
      .catch((value) => value);
    expect(error).toMatchObject({
      code: "http_error",
      message: "Broker transport request failed",
    });
    expect(JSON.stringify(error)).not.toContain(serverText);
  });

  it("rejects malformed or inconsistent response lengths", async () => {
    const mismatched = transport(async () =>
      response(Uint8Array.of(1), { contentLength: "2" }),
    );
    await expect(mismatched.ack(new Uint8Array())).rejects.toMatchObject({
      code: "invalid_response",
      message: "Broker transport request failed",
    });

    const cancelMalformed = vi.fn(async () => {});
    const malformed = transport(async () => ({
      ok: true,
      headers: {
        get: (name) =>
          name.toLowerCase() === "content-type"
            ? "application/octet-stream"
            : "01",
      },
      body: {
        getReader: () => ({
          read: async () => ({ done: true as const }),
          cancel: cancelMalformed,
        }),
      },
    }));
    await expect(malformed.ack(new Uint8Array())).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(cancelMalformed).toHaveBeenCalledTimes(1);

    const missingBody = transport(async () => ({
      ok: true,
      headers: {
        get: (name) =>
          name.toLowerCase() === "content-type"
            ? "application/octet-stream"
            : "1",
      },
      body: null,
    }));
    await expect(missingBody.ack(new Uint8Array())).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("requires exact octet-stream success responses", async () => {
    const missing = transport(async () =>
      response(new Uint8Array(), { contentType: null }),
    );
    await expect(missing.ack(new Uint8Array())).rejects.toMatchObject({
      code: "invalid_response",
    });

    const json = transport(async () =>
      response(encoder.encode("{}"), { contentType: "application/json" }),
    );
    await expect(json.ack(new Uint8Array())).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects non-origin base URLs", () => {
    expect(
      () =>
        new SignedHostedBrokerTransport({
          baseUrl: "https://vault.example.test/hidden-prefix",
          vaultId: "vault-transport-0001",
          endpointId: "endpoint-transport-0001",
          signer,
          fetch: async () => response(),
        }),
    ).toThrow(BrokerTransportError);
    expect(
      () =>
        new SignedHostedBrokerTransport({
          baseUrl: "http://vault.example.test",
          vaultId: "vault-transport-0001",
          endpointId: "endpoint-transport-0001",
          signer,
          fetch: async () => response(),
        }),
    ).toThrow(BrokerTransportError);
    expect(
      () =>
        new SignedHostedBrokerTransport({
          baseUrl: "http://127.0.0.1:3000",
          vaultId: "vault-transport-0001",
          endpointId: "endpoint-transport-0001",
          signer,
          fetch: async () => response(),
        }),
    ).not.toThrow();
  });

  it("collapses response-body access failures to a content-free error", async () => {
    const client = transport(async () => ({
      ok: false,
      headers: { get: () => null },
      body: {
        getReader() {
          throw new Error("private response-body diagnostic");
        },
      },
    }));
    const error = await client.ack(new Uint8Array()).catch((value) => value);
    expect(error).toMatchObject({
      code: "http_error",
      message: "Broker transport request failed",
    });
    expect(JSON.stringify(error)).not.toContain("private response-body");
  });

  it("keeps the timeout active through request and streamed response completion", async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch = new SignedHostedBrokerTransport({
        baseUrl: "https://vault.example.test",
        vaultId: "vault-transport-0001",
        endpointId: "endpoint-transport-0001",
        signer,
        crypto,
        requestTimeoutMs: 1_000,
        fetch: async (_url, init) =>
          await new Promise<BrokerFetchResponse>((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new Error("private request timeout diagnostic")),
            );
          }),
      });
      const stalledRequest = stalledFetch.ack(new Uint8Array());
      const stalledAssertion = expect(stalledRequest).rejects.toMatchObject({
        code: "network_failed",
        message: "Broker transport request failed",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await stalledAssertion;

      const stalledStream = new SignedHostedBrokerTransport({
        baseUrl: "https://vault.example.test",
        vaultId: "vault-transport-0001",
        endpointId: "endpoint-transport-0001",
        signer,
        crypto,
        requestTimeoutMs: 1_000,
        fetch: async (_url, init) => ({
          ok: true,
          headers: {
            get: (name) =>
              name.toLowerCase() === "content-type"
                ? "application/octet-stream"
                : null,
          },
          body: {
            getReader() {
              return {
                async read() {
                  return await new Promise<never>((_resolve, reject) => {
                    init.signal.addEventListener("abort", () =>
                      reject(new Error("private stream timeout diagnostic")),
                    );
                  });
                },
                async cancel() {},
              };
            },
          },
        }),
      });
      const streamedRequest = stalledStream.ack(new Uint8Array());
      const streamedAssertion = expect(streamedRequest).rejects.toMatchObject({
        code: "invalid_response",
        message: "Broker transport request failed",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await streamedAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects oversized request bodies before signing or fetching", async () => {
    const fetch = vi.fn<BrokerFetch>(async () => response());
    const sign = vi.fn(async () => new Uint8Array(64));
    const client = new SignedHostedBrokerTransport({
      baseUrl: "https://vault.example.test",
      vaultId: "vault-transport-0001",
      endpointId: "endpoint-transport-0001",
      signer: { signEndpointRequest: sign },
      fetch,
    });
    await expect(
      client.result(new Uint8Array(BROKER_REQUEST_MAX_BYTES + 1)),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(sign).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
