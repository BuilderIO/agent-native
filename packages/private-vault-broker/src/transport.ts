import {
  ancV1BytesToHex,
  encodeEndpointRequestUnsignedProof,
  endpointRequestProofSchema,
  endpointRequestUnsignedProofSchema,
  E2EE_SIZE_LIMITS,
  type EndpointRequestProof,
} from "@agent-native/core/e2ee";

import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";

export const BROKER_JOB_PATHS = Object.freeze({
  claim: "/api/private-vault/jobs/broker/claim",
  request: "/api/private-vault/jobs/broker/request",
  ack: "/api/private-vault/jobs/broker/ack",
  retry: "/api/private-vault/jobs/broker/retry",
  result: "/api/private-vault/jobs/broker/result",
} as const);

export type BrokerJobPath =
  (typeof BROKER_JOB_PATHS)[keyof typeof BROKER_JOB_PATHS];
export const ANC_ENDPOINT_PROOF_HEADER = "X-ANC-Endpoint-Proof";
export const BROKER_CONTROL_RESPONSE_MAX_BYTES = 64 * 1024;
export const BROKER_JOB_RESPONSE_MAX_BYTES =
  E2EE_SIZE_LIMITS.jobPayloadBytes + 64 * 1024;
export const BROKER_REQUEST_MAX_BYTES =
  E2EE_SIZE_LIMITS.resultPayloadBytes + 8 * 1024 + 4;

export type BrokerTransportErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "signing_failed"
  | "network_failed"
  | "http_error"
  | "response_too_large"
  | "invalid_response";

export class BrokerTransportError extends Error {
  readonly code: BrokerTransportErrorCode;

  constructor(code: BrokerTransportErrorCode) {
    super("Broker transport request failed");
    this.name = "BrokerTransportError";
    this.code = code;
  }
}

export interface EndpointRequestSigner {
  /**
   * Sign only an anc/v1 endpoint-request payload and never retain it. Ownership
   * of the returned signature buffer transfers to the transport.
   */
  signEndpointRequest(payload: Uint8Array): Promise<Uint8Array>;
}

interface BrokerResponseBodyReader {
  read(): Promise<
    | { readonly done: true; readonly value?: undefined }
    | { readonly done: false; readonly value: Uint8Array }
  >;
  cancel(): Promise<void>;
}

export interface BrokerFetchResponse {
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: { getReader(): BrokerResponseBodyReader } | null;
}

export type BrokerFetch = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly redirect: "error";
    readonly credentials: "omit";
    readonly cache: "no-store";
    readonly signal: AbortSignal;
  },
) => Promise<BrokerFetchResponse>;

export interface SignedHostedBrokerTransportOptions {
  readonly baseUrl: string | URL;
  readonly vaultId: string;
  readonly endpointId: string;
  readonly signer: EndpointRequestSigner;
  readonly crypto?: AncV1CryptoProvider;
  readonly fetch?: BrokerFetch;
  readonly now?: () => Date;
  readonly requestTimeoutMs?: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_PROOF_HEADER_BYTES = 16 * 1024;

function fail(code: BrokerTransportErrorCode): never {
  throw new BrokerTransportError(code);
}

function exactOrigin(value: string | URL): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("invalid_configuration");
  }
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && loopback)) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    fail("invalid_configuration");
  }
  return parsed.origin;
}

async function cancelResponseBody(
  response: BrokerFetchResponse,
): Promise<void> {
  try {
    const body = response.body;
    if (body) await body.getReader().cancel();
  } catch {}
}

export function encodeEndpointProofHeader(proof: EndpointRequestProof): string {
  try {
    const parsed = endpointRequestProofSchema.parse(proof);
    return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  } catch {
    fail("invalid_request");
  }
}

export function decodeEndpointProofHeader(value: string): EndpointRequestProof {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROOF_HEADER_BYTES ||
    !BASE64URL.test(value)
  ) {
    fail("invalid_request");
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) fail("invalid_request");
    const text = decoder.decode(decoded);
    const proof = endpointRequestProofSchema.parse(JSON.parse(text));
    if (JSON.stringify(proof) !== text) fail("invalid_request");
    return proof;
  } catch (error) {
    if (error instanceof BrokerTransportError) throw error;
    fail("invalid_request");
  }
}

export async function createNativeEndpointRequestProof(input: {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly path: BrokerJobPath;
  readonly body: Uint8Array;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly signer: EndpointRequestSigner;
  readonly crypto?: AncV1CryptoProvider;
}): Promise<EndpointRequestProof> {
  const crypto = input.crypto ?? sodiumNativeAncV1;
  if (!(input.body instanceof Uint8Array)) fail("invalid_request");
  const hash = crypto.hash("endpoint-request-body", input.body);
  let unsignedBytes: Uint8Array | null = null;
  let signature: Uint8Array | null = null;
  try {
    const unsigned = endpointRequestUnsignedProofSchema.parse({
      version: 1,
      suite: "anc/v1",
      type: "endpoint_request",
      vaultId: input.vaultId,
      endpointId: input.endpointId,
      method: "POST",
      path: input.path,
      bodyHash: ancV1BytesToHex(hash),
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    });
    unsignedBytes = encodeEndpointRequestUnsignedProof(unsigned);
    signature = await input.signer.signEndpointRequest(unsignedBytes);
    return endpointRequestProofSchema.parse({
      ...unsigned,
      signature: ancV1BytesToHex(signature),
    });
  } catch (error) {
    if (error instanceof BrokerTransportError) throw error;
    return fail("signing_failed");
  } finally {
    crypto.zeroize(hash);
    if (unsignedBytes) crypto.zeroize(unsignedBytes);
    if (signature) crypto.zeroize(signature);
  }
}

async function readBoundedResponse(
  response: BrokerFetchResponse,
  maxBytes: number,
): Promise<Uint8Array> {
  let contentType: string | null;
  let contentLength: string | null;
  try {
    contentType = response.headers.get("content-type");
    contentLength = response.headers.get("content-length");
  } catch {
    await cancelResponseBody(response);
    fail("invalid_response");
  }
  if (contentType?.trim().toLowerCase() !== "application/octet-stream") {
    await cancelResponseBody(response);
    fail("invalid_response");
  }
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      fail("invalid_response");
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) {
      await cancelResponseBody(response);
      fail("invalid_response");
    }
    if (declared > maxBytes) {
      await cancelResponseBody(response);
      fail("response_too_large");
    }
  }
  if (!response.body) {
    if (contentLength !== null && Number(contentLength) !== 0) {
      fail("invalid_response");
    }
    return new Uint8Array();
  }
  let reader: BrokerResponseBodyReader;
  try {
    reader = response.body.getReader();
  } catch {
    await cancelResponseBody(response);
    fail("invalid_response");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail("invalid_response");
      total += part.value.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) {
        await reader.cancel().catch(() => {});
        fail("response_too_large");
      }
      chunks.push(Uint8Array.from(part.value));
    }
    if (contentLength !== null && Number(contentLength) !== total) {
      fail("invalid_response");
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    completed = true;
    return result;
  } catch (error) {
    if (error instanceof BrokerTransportError) throw error;
    fail("invalid_response");
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    if (!completed) {
      try {
        await reader.cancel();
      } catch {}
    }
  }
  return fail("invalid_response");
}

export class SignedHostedBrokerTransport {
  readonly #origin: string;
  readonly #vaultId: string;
  readonly #endpointId: string;
  readonly #signer: EndpointRequestSigner;
  readonly #crypto: AncV1CryptoProvider;
  readonly #fetch: BrokerFetch;
  readonly #now: () => Date;
  readonly #requestTimeoutMs: number;

  constructor(options: SignedHostedBrokerTransportOptions) {
    this.#origin = exactOrigin(options.baseUrl);
    this.#vaultId = options.vaultId;
    this.#endpointId = options.endpointId;
    this.#signer = options.signer;
    this.#crypto = options.crypto ?? sodiumNativeAncV1;
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as BrokerFetch);
    this.#now = options.now ?? (() => new Date());
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (typeof this.#fetch !== "function") fail("invalid_configuration");
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1_000 ||
      this.#requestTimeoutMs > 120_000
    ) {
      fail("invalid_configuration");
    }
  }

  claim(body: Uint8Array): Promise<Uint8Array> {
    return this.#post(
      BROKER_JOB_PATHS.claim,
      body,
      BROKER_JOB_RESPONSE_MAX_BYTES,
    );
  }

  request(body: Uint8Array): Promise<Uint8Array> {
    return this.#post(
      BROKER_JOB_PATHS.request,
      body,
      BROKER_JOB_RESPONSE_MAX_BYTES,
    );
  }

  ack(body: Uint8Array): Promise<Uint8Array> {
    return this.#post(
      BROKER_JOB_PATHS.ack,
      body,
      BROKER_CONTROL_RESPONSE_MAX_BYTES,
    );
  }

  retry(body: Uint8Array): Promise<Uint8Array> {
    return this.#post(
      BROKER_JOB_PATHS.retry,
      body,
      BROKER_CONTROL_RESPONSE_MAX_BYTES,
    );
  }

  result(body: Uint8Array): Promise<Uint8Array> {
    return this.#post(
      BROKER_JOB_PATHS.result,
      body,
      BROKER_CONTROL_RESPONSE_MAX_BYTES,
    );
  }

  async #post(
    path: BrokerJobPath,
    body: Uint8Array,
    responseMaxBytes: number,
  ): Promise<Uint8Array> {
    if (
      !(body instanceof Uint8Array) ||
      body.byteLength > BROKER_REQUEST_MAX_BYTES
    ) {
      fail("invalid_request");
    }
    const ownedBody = Uint8Array.from(body);
    const nonceBytes = this.#crypto.randomBytes(16);
    let proof: EndpointRequestProof;
    try {
      proof = await createNativeEndpointRequestProof({
        vaultId: this.#vaultId,
        endpointId: this.#endpointId,
        path,
        body: ownedBody,
        issuedAt: this.#now().toISOString(),
        nonce: ancV1BytesToHex(nonceBytes),
        signer: this.#signer,
        crypto: this.#crypto,
      });
    } catch (error) {
      if (error instanceof BrokerTransportError) throw error;
      fail("signing_failed");
    } finally {
      this.#crypto.zeroize(nonceBytes);
    }

    let response: BrokerFetchResponse;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#requestTimeoutMs,
    );
    if (typeof timeout === "object" && "unref" in timeout) timeout.unref();
    try {
      try {
        response = await this.#fetch(`${this.#origin}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/octet-stream",
            "Content-Type": "application/octet-stream",
            [ANC_ENDPOINT_PROOF_HEADER]: encodeEndpointProofHeader(proof),
          },
          body: ownedBody,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        fail("network_failed");
      } finally {
        this.#crypto.zeroize(ownedBody);
      }
      let responseOk: boolean;
      try {
        responseOk = response.ok;
      } catch {
        fail("invalid_response");
      }
      if (!responseOk) {
        await cancelResponseBody(response);
        fail("http_error");
      }
      return await readBoundedResponse(response, responseMaxBytes);
    } finally {
      clearTimeout(timeout);
    }
  }
}
