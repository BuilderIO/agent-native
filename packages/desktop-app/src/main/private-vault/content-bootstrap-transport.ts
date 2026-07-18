import {
  ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES,
  decodeAncV1VaultBootstrapResponse,
  encodeAncV1VaultBootstrapRequest,
  type AncV1VaultBootstrapRequest,
  type AncV1VaultBootstrapResponse,
} from "@agent-native/core/e2ee";

import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const BOOTSTRAP_PATH = "/api/private-vault/bootstrap";
const MEDIA_TYPE = "application/octet-stream";

export class PrivateVaultContentBootstrapTransportError extends Error {
  constructor() {
    super("Private Vault bootstrap transport unavailable");
    this.name = "PrivateVaultContentBootstrapTransportError";
  }
}

export interface PrivateVaultBootstrapPageAcceptance {
  readonly vaultId: string;
  readonly throughSequence: number;
  readonly head: { readonly sequence: number; readonly hash: string };
  readonly complete: boolean;
}

export interface PrivateVaultBootstrapPageConsumer {
  /**
   * Transfers one exact hosted frame into the signed native trust boundary.
   * The consumer must replay entries and authenticate the final recovery wrap;
   * it may not trust the JavaScript-decoded projection.
   */
  acceptPage(encoded: Uint8Array): Promise<PrivateVaultBootstrapPageAcceptance>;
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
    throw new PrivateVaultContentBootstrapTransportError();
  }
}

function exactDeclaredLength(value: string | null): number {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) {
    throw new PrivateVaultContentBootstrapTransportError();
  }
  const length = Number(value);
  if (
    !Number.isSafeInteger(length) ||
    length > ANC_V1_VAULT_BOOTSTRAP_FRAME_MAX_BYTES
  ) {
    throw new PrivateVaultContentBootstrapTransportError();
  }
  return length;
}

export class PrivateVaultContentBootstrapTransport {
  readonly #session: PrivateVaultContentSession;
  readonly #origin: string;

  constructor(input: {
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
  }) {
    this.#session = input.session;
    this.#origin = exactHttpsOrigin(input.origin);
  }

  async fetchPage(
    request: AncV1VaultBootstrapRequest,
  ): Promise<AncV1VaultBootstrapResponse & { readonly encoded: Uint8Array }> {
    try {
      const requestBody = encodeAncV1VaultBootstrapRequest(request);
      const url = `${this.#origin}${BOOTSTRAP_PATH}`;
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: MEDIA_TYPE,
          "Cache-Control": "no-store",
          "Content-Length": String(requestBody.byteLength),
          "Content-Type": MEDIA_TYPE,
          Origin: this.#origin,
          "X-Agent-Native-CSRF": "1",
        },
        body: Buffer.from(requestBody),
      });
      const declaredLength = exactDeclaredLength(
        response.headers.get("content-length"),
      );
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.trim().toLowerCase() !==
          MEDIA_TYPE
      ) {
        throw new Error("invalid response");
      }
      const encoded = new Uint8Array(await response.arrayBuffer());
      if (encoded.byteLength !== declaredLength) {
        throw new Error("truncated response");
      }
      const page = decodeAncV1VaultBootstrapResponse(encoded);
      if (
        page.metadata.afterSequence !== request.afterSequence ||
        (request.expectedHead &&
          (page.metadata.head.sequence !== request.expectedHead.sequence ||
            page.metadata.head.hash !== request.expectedHead.hash))
      ) {
        throw new Error("response substitution");
      }
      return { ...page, encoded };
    } catch (error) {
      if (error instanceof PrivateVaultContentBootstrapTransportError) {
        throw error;
      }
      throw new PrivateVaultContentBootstrapTransportError();
    }
  }

  async transfer(
    consumer: PrivateVaultBootstrapPageConsumer,
  ): Promise<PrivateVaultBootstrapPageAcceptance> {
    let request: AncV1VaultBootstrapRequest = {
      version: 1,
      suite: "anc/v1",
      type: "vault-bootstrap-request",
      afterSequence: -1,
      expectedHead: null,
    };
    let expectedVaultId: string | null = null;
    while (true) {
      const page = await this.fetchPage(request);
      const accepted = await consumer.acceptPage(Uint8Array.from(page.encoded));
      if (
        accepted.vaultId !== page.metadata.vaultId ||
        (expectedVaultId !== null && accepted.vaultId !== expectedVaultId) ||
        accepted.throughSequence !== page.metadata.throughSequence ||
        accepted.head.sequence !== page.metadata.head.sequence ||
        accepted.head.hash !== page.metadata.head.hash ||
        accepted.complete !== page.metadata.complete
      ) {
        throw new PrivateVaultContentBootstrapTransportError();
      }
      expectedVaultId = accepted.vaultId;
      if (accepted.complete) return accepted;
      if (accepted.throughSequence <= request.afterSequence) {
        throw new PrivateVaultContentBootstrapTransportError();
      }
      request = {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-request",
        afterSequence: accepted.throughSequence,
        expectedHead: accepted.head,
      };
    }
  }
}
