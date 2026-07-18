import {
  ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
} from "@agent-native/core/e2ee";

import type {
  PrivateVaultEndpointAuthenticatedRequest,
  PrivateVaultGenesisHostedTransport,
} from "./genesis-admission-coordinator.js";

const CHALLENGE_PATH = "/api/private-vault/genesis/challenge";
const ADMIT_PATH = "/api/private-vault/genesis/admit";
const APPEND_PATH = "/api/private-vault/control-log/append";
const CANDIDATE_TYPE =
  "application/vnd.agent-native.genesis-admission-candidate+cbor";
const CHALLENGE_TYPE =
  "application/vnd.agent-native.genesis-admission-challenge+cbor";
const ADMISSION_TYPE = "application/vnd.agent-native.genesis-admission+cbor";
const APPEND_TYPE = "application/vnd.agent-native.control-log+cbor";

export interface PrivateVaultContentSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export class PrivateVaultContentGenesisTransportError extends Error {
  constructor() {
    super("Private Vault hosted ceremony transport unavailable");
    this.name = "PrivateVaultContentGenesisTransportError";
  }
}

function exactHttpsOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid origin");
    }
    return parsed.origin;
  } catch {
    throw new PrivateVaultContentGenesisTransportError();
  }
}

function exactBytes(value: Uint8Array, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    throw new PrivateVaultContentGenesisTransportError();
  }
  return value.slice();
}

function validProofHeader(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8192 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export class PrivateVaultContentGenesisTransport implements PrivateVaultGenesisHostedTransport {
  readonly #session: PrivateVaultContentSession;
  readonly #origin: string;

  constructor(input: {
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
  }) {
    this.#session = input.session;
    this.#origin = exactHttpsOrigin(input.origin);
  }

  issueChallenge(candidate: Uint8Array): Promise<Uint8Array> {
    return this.#post({
      path: CHALLENGE_PATH,
      body: exactBytes(
        candidate,
        ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
      ),
      requestType: CANDIDATE_TYPE,
      responseType: CHALLENGE_TYPE,
      responseMaximum: ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
      authenticatedSession: true,
    });
  }

  admit(
    request: PrivateVaultEndpointAuthenticatedRequest,
  ): Promise<Uint8Array> {
    return this.#postAuthenticated({
      path: ADMIT_PATH,
      request,
      bodyMaximum: ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
      mediaType: ADMISSION_TYPE,
      responseMaximum: ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
      authenticatedSession: true,
    });
  }

  appendGenesis(
    request: PrivateVaultEndpointAuthenticatedRequest,
  ): Promise<Uint8Array> {
    return this.#postAuthenticated({
      path: APPEND_PATH,
      request,
      bodyMaximum: ANC_V1_CONTROL_LOG_APPEND_REQUEST_MAX_BYTES,
      mediaType: APPEND_TYPE,
      responseMaximum: 2048,
      authenticatedSession: false,
    });
  }

  #postAuthenticated(input: {
    path: string;
    request: PrivateVaultEndpointAuthenticatedRequest;
    bodyMaximum: number;
    mediaType: string;
    responseMaximum: number;
    authenticatedSession: boolean;
  }): Promise<Uint8Array> {
    if (!validProofHeader(input.request.proofHeader)) {
      return Promise.reject(new PrivateVaultContentGenesisTransportError());
    }
    return this.#post({
      path: input.path,
      body: exactBytes(input.request.body, input.bodyMaximum),
      requestType: input.mediaType,
      responseType: input.mediaType,
      responseMaximum: input.responseMaximum,
      authenticatedSession: input.authenticatedSession,
      proofHeader: input.request.proofHeader,
    });
  }

  async #post(input: {
    path: string;
    body: Uint8Array;
    requestType: string;
    responseType: string;
    responseMaximum: number;
    authenticatedSession: boolean;
    proofHeader?: string;
  }): Promise<Uint8Array> {
    try {
      const headers: Record<string, string> = {
        Accept: input.responseType,
        "Cache-Control": "no-store",
        "Content-Length": String(input.body.byteLength),
        "Content-Type": input.requestType,
        Origin: this.#origin,
      };
      if (input.authenticatedSession) headers["X-Agent-Native-CSRF"] = "1";
      if (input.proofHeader) {
        headers["X-ANC-Endpoint-Request-Proof"] = input.proofHeader;
      }
      const response = await this.#session.fetch(
        `${this.#origin}${input.path}`,
        {
          method: "POST",
          redirect: "error",
          credentials: input.authenticatedSession ? "include" : "omit",
          cache: "no-store",
          headers,
          body: Buffer.from(input.body),
        },
      );
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        response.status !== 200 ||
        response.url !== `${this.#origin}${input.path}` ||
        response.redirected ||
        response.headers.get("content-type")?.trim().toLowerCase() !==
          input.responseType ||
        !Number.isSafeInteger(declaredLength) ||
        declaredLength <= 0 ||
        declaredLength > input.responseMaximum
      ) {
        throw new Error("invalid response");
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength !== declaredLength) {
        throw new Error("truncated response");
      }
      return body;
    } catch {
      throw new PrivateVaultContentGenesisTransportError();
    }
  }
}
