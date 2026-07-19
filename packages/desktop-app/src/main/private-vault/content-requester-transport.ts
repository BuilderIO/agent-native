import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const MAXIMUM_GRANT_BYTES = 64 * 1024;
const MAXIMUM_JOB_BYTES = 16 * 1024 * 1024 + 64 * 1024;
const MAXIMUM_RESULT_BYTES = 16 * 1024 * 1024 + 64 * 1024;
const MAXIMUM_JSON_BYTES = 4096;

export class PrivateVaultContentRequesterTransportError extends Error {
  constructor(readonly status?: number) {
    super("Private Vault requester transport unavailable");
    this.name = "PrivateVaultContentRequesterTransportError";
  }
}

function exactOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new PrivateVaultContentRequesterTransportError();
  }
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

async function exactJson(
  response: Response,
  expectedUrl: string,
): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (
    !response.ok ||
    response.url !== expectedUrl ||
    response.redirected ||
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
      "application/json" ||
    length === null ||
    !/^[1-9][0-9]*$/.test(length) ||
    Number(length) > MAXIMUM_JSON_BYTES
  )
    throw new PrivateVaultContentRequesterTransportError();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== Number(length))
    throw new PrivateVaultContentRequesterTransportError();
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new PrivateVaultContentRequesterTransportError();
  }
}

function body(input: Uint8Array, maximum: number) {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength === 0 ||
    input.byteLength > maximum
  )
    throw new PrivateVaultContentRequesterTransportError();
  return Buffer.from(input);
}

export class PrivateVaultContentRequesterTransport {
  readonly #origin: string;
  readonly #session: PrivateVaultContentSession;

  constructor(input: {
    readonly origin: string;
    readonly session: PrivateVaultContentSession;
  }) {
    this.#origin = exactOrigin(input.origin);
    this.#session = input.session;
  }

  async putGrant(input: {
    vaultId: string;
    grantId: string;
    recipientEndpointId: string;
    issuedAt: string;
    expiresAt: string;
    ciphertext: Uint8Array;
  }) {
    const ciphertext = body(input.ciphertext, MAXIMUM_GRANT_BYTES);
    if (
      !lowerHex(input.vaultId, 16) ||
      !lowerHex(input.grantId, 16) ||
      !lowerHex(input.recipientEndpointId, 16) ||
      !timestamp(input.issuedAt) ||
      !timestamp(input.expiresAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
    )
      throw new PrivateVaultContentRequesterTransportError();
    try {
      const url = `${this.#origin}/api/private-vault/grants`;
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "Content-Length": String(ciphertext.byteLength),
          "Content-Type": "application/octet-stream",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": input.vaultId,
          "X-ANC-Grant-Id": input.grantId,
          "X-ANC-Recipient-Endpoint-Id": input.recipientEndpointId,
          "X-ANC-Algorithm-Id": "anc/v1",
          "X-ANC-Ciphertext-Byte-Length": String(ciphertext.byteLength),
          "X-ANC-Issued-At": input.issuedAt,
          "X-ANC-Expires-At": input.expiresAt,
        },
        body: ciphertext,
      });
      if (!response.ok)
        throw new PrivateVaultContentRequesterTransportError(response.status);
      const result = await exactJson(response, url);
      if (
        result.vaultId !== input.vaultId ||
        result.grantId !== input.grantId ||
        result.recipientEndpointId !== input.recipientEndpointId ||
        result.algorithmId !== "anc/v1" ||
        result.ciphertextByteLength !== ciphertext.byteLength ||
        result.issuedAt !== input.issuedAt ||
        result.expiresAt !== input.expiresAt
      )
        throw new Error();
      return Object.freeze({ ...result });
    } catch (error) {
      if (error instanceof PrivateVaultContentRequesterTransportError)
        throw error;
      throw new PrivateVaultContentRequesterTransportError();
    } finally {
      ciphertext.fill(0);
    }
  }

  async revokeGrant(input: { vaultId: string; grantId: string }) {
    if (!lowerHex(input.vaultId, 16) || !lowerHex(input.grantId, 16))
      throw new PrivateVaultContentRequesterTransportError();
    try {
      const url = `${this.#origin}/api/private-vault/grants/${input.grantId}`;
      const response = await this.#session.fetch(url, {
        method: "DELETE",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": input.vaultId,
        },
      });
      if (!response.ok)
        throw new PrivateVaultContentRequesterTransportError(response.status);
      const result = await exactJson(response, url);
      if (
        Object.keys(result).sort().join("\0") !== "grantId\0state\0vaultId" ||
        result.vaultId !== input.vaultId ||
        result.grantId !== input.grantId ||
        result.state !== "revoked"
      )
        throw new Error();
      return Object.freeze({
        vaultId: input.vaultId,
        grantId: input.grantId,
        state: "revoked" as const,
      });
    } catch (error) {
      if (error instanceof PrivateVaultContentRequesterTransportError)
        throw error;
      throw new PrivateVaultContentRequesterTransportError();
    }
  }

  async putJob(input: {
    vaultId: string;
    jobId: string;
    grantId: string;
    recipientEndpointId: string;
    epoch: number;
    issuedAt: string;
    expiresAt: string;
    ciphertext: Uint8Array;
  }) {
    const ciphertext = body(input.ciphertext, MAXIMUM_JOB_BYTES);
    if (
      !lowerHex(input.vaultId, 16) ||
      !lowerHex(input.jobId, 16) ||
      !lowerHex(input.grantId, 16) ||
      !lowerHex(input.recipientEndpointId, 16) ||
      !positive(input.epoch) ||
      !timestamp(input.issuedAt) ||
      !timestamp(input.expiresAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)
    )
      throw new PrivateVaultContentRequesterTransportError();
    try {
      const url = `${this.#origin}/api/private-vault/jobs`;
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "Content-Length": String(ciphertext.byteLength),
          "Content-Type": "application/octet-stream",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": input.vaultId,
          "X-ANC-Job-Id": input.jobId,
          "X-ANC-Grant-Id": input.grantId,
          "X-ANC-Recipient-Endpoint-Id": input.recipientEndpointId,
          "X-ANC-Epoch": String(input.epoch),
          "X-ANC-Algorithm-Id": "anc/v1",
          "X-ANC-Ciphertext-Byte-Length": String(ciphertext.byteLength),
          "X-ANC-Issued-At": input.issuedAt,
          "X-ANC-Expires-At": input.expiresAt,
        },
        body: ciphertext,
      });
      if (!response.ok)
        throw new PrivateVaultContentRequesterTransportError(response.status);
      const result = await exactJson(response, url);
      if (
        result.vaultId !== input.vaultId ||
        result.jobId !== input.jobId ||
        result.grantId !== input.grantId ||
        result.recipientEndpointId !== input.recipientEndpointId ||
        result.epoch !== input.epoch ||
        result.algorithmId !== "anc/v1" ||
        result.ciphertextByteLength !== ciphertext.byteLength ||
        result.issuedAt !== input.issuedAt ||
        result.expiresAt !== input.expiresAt
      )
        throw new Error();
      return Object.freeze({ ...result });
    } catch (error) {
      if (error instanceof PrivateVaultContentRequesterTransportError)
        throw error;
      throw new PrivateVaultContentRequesterTransportError();
    } finally {
      ciphertext.fill(0);
    }
  }

  async getResult(input: { vaultId: string; jobId: string }) {
    if (!lowerHex(input.vaultId, 16) || !lowerHex(input.jobId, 16))
      throw new PrivateVaultContentRequesterTransportError();
    try {
      const url = `${this.#origin}/api/private-vault/jobs/${input.jobId}/result`;
      const response = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": input.vaultId,
        },
      });
      if (!response.ok)
        throw new PrivateVaultContentRequesterTransportError(response.status);
      const length = response.headers.get("content-length");
      const state = response.headers.get("x-anc-job-state");
      const epoch = Number(response.headers.get("x-anc-epoch"));
      const jobHash = response.headers.get("x-anc-job-hash");
      if (
        !response.ok ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type") !== "application/octet-stream" ||
        length === null ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > MAXIMUM_RESULT_BYTES ||
        (state !== "completed" && state !== "failed") ||
        !positive(epoch) ||
        !lowerHex(jobHash, 32) ||
        response.headers.get("x-anc-algorithm-id") !== "anc/v1"
      )
        throw new Error();
      const ciphertext = new Uint8Array(await response.arrayBuffer());
      if (ciphertext.byteLength !== Number(length)) throw new Error();
      return Object.freeze({
        vaultId: input.vaultId,
        jobId: input.jobId,
        state,
        epoch,
        jobHash,
        algorithmId: "anc/v1" as const,
        ciphertext,
      });
    } catch (error) {
      if (error instanceof PrivateVaultContentRequesterTransportError)
        throw error;
      throw new PrivateVaultContentRequesterTransportError();
    }
  }
}
