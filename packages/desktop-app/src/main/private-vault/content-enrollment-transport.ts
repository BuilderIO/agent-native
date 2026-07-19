import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const MEDIA_TYPE = "application/vnd.agent-native.private-vault-enrollment+cbor";
const OFFER_MAX_BYTES = 64 * 1024;
const CHALLENGE_MAX_BYTES = 64 * 1024;
const AUTHORIZATION_MAX_BYTES = 256 * 1024;
const STATUS_MAX_BYTES = 512 * 1024;

export type PrivateVaultEnrollmentPhase = "offer" | "challenge" | "committed";

export interface PrivateVaultHostedEnrollmentStatus {
  readonly phase: PrivateVaultEnrollmentPhase;
  readonly offer: Uint8Array;
  readonly challenge: Uint8Array | null;
  readonly authorization: Uint8Array | null;
  readonly controlEntryId: string | null;
  readonly controlEntryHash: string | null;
  readonly expiresAt: string;
}

export class PrivateVaultContentEnrollmentTransportError extends Error {
  constructor() {
    super("Private Vault enrollment transport unavailable");
    this.name = "PrivateVaultContentEnrollmentTransportError";
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
    throw new PrivateVaultContentEnrollmentTransportError();
  }
}

function exactBytes(value: Uint8Array, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  return value.slice();
}

function decodeBase64url(value: unknown, maximum: number): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((maximum * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.byteLength === 0 ||
    decoded.byteLength > maximum ||
    decoded.toString("base64url") !== value
  ) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  return Uint8Array.from(decoded);
}

function optionalBytes(value: unknown, maximum: number): Uint8Array | null {
  return value === null ? null : decodeBase64url(value, maximum);
}

function exactStatus(value: unknown): PrivateVaultHostedEnrollmentStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expected = [
    "authorization",
    "challenge",
    "controlEntryHash",
    "controlEntryId",
    "expiresAt",
    "offer",
    "phase",
    "suite",
    "version",
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    input.version !== 1 ||
    input.suite !== "anc/v1" ||
    (input.phase !== "offer" &&
      input.phase !== "challenge" &&
      input.phase !== "committed") ||
    typeof input.expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt)
  ) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  const offer = decodeBase64url(input.offer, OFFER_MAX_BYTES);
  const challenge = optionalBytes(input.challenge, CHALLENGE_MAX_BYTES);
  const authorization = optionalBytes(
    input.authorization,
    AUTHORIZATION_MAX_BYTES,
  );
  const controlEntryId = input.controlEntryId;
  const controlEntryHash = input.controlEntryHash;
  const committed = input.phase === "committed";
  if (
    (input.phase === "offer" &&
      (challenge !== null ||
        authorization !== null ||
        controlEntryId !== null ||
        controlEntryHash !== null)) ||
    (input.phase === "challenge" &&
      (challenge === null ||
        authorization !== null ||
        controlEntryId !== null ||
        controlEntryHash !== null)) ||
    (committed &&
      (challenge === null ||
        authorization === null ||
        typeof controlEntryId !== "string" ||
        !/^[0-9a-f]{32}$/.test(controlEntryId) ||
        typeof controlEntryHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(controlEntryHash)))
  ) {
    throw new PrivateVaultContentEnrollmentTransportError();
  }
  return Object.freeze({
    phase: input.phase,
    offer,
    challenge,
    authorization,
    controlEntryId: controlEntryId as string | null,
    controlEntryHash: controlEntryHash as string | null,
    expiresAt: input.expiresAt,
  });
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

export class PrivateVaultContentEnrollmentTransport {
  readonly #session: PrivateVaultContentSession;
  readonly #origin: string;

  constructor(input: {
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
  }) {
    this.#session = input.session;
    this.#origin = exactHttpsOrigin(input.origin);
  }

  publishOffer(offerHash: string, offer: Uint8Array) {
    return this.#post(
      "/api/private-vault/enrollment/offer",
      offerHash,
      exactBytes(offer, OFFER_MAX_BYTES),
    );
  }

  publishChallenge(
    offerHash: string,
    offer: Uint8Array,
    challenge: Uint8Array,
  ) {
    return this.#post(
      `/api/private-vault/enrollment/${offerHash}/challenge`,
      offerHash,
      exactBytes(challenge, CHALLENGE_MAX_BYTES),
      offer,
    );
  }

  publishAuthorization(
    offerHash: string,
    offer: Uint8Array,
    authorization: Uint8Array,
  ) {
    return this.#post(
      `/api/private-vault/enrollment/${offerHash}/authorization`,
      offerHash,
      exactBytes(authorization, AUTHORIZATION_MAX_BYTES),
      offer,
    );
  }

  readStatus(offerHash: string, offer: Uint8Array) {
    return this.#request(
      `/api/private-vault/enrollment/${offerHash}/status`,
      offerHash,
      { method: "GET" },
      offer,
    );
  }

  async #post(
    path: string,
    offerHash: string,
    body: Uint8Array,
    expectedOffer?: Uint8Array,
  ) {
    return this.#request(
      path,
      offerHash,
      {
        method: "POST",
        body: Buffer.from(body),
        headers: {
          "Content-Length": String(body.byteLength),
          "Content-Type": MEDIA_TYPE,
          "X-Agent-Native-CSRF": "1",
        },
      },
      expectedOffer ?? body,
    );
  }

  async #request(
    path: string,
    offerHash: string,
    init: Pick<RequestInit, "method" | "body" | "headers">,
    expectedOffer: Uint8Array,
  ): Promise<PrivateVaultHostedEnrollmentStatus> {
    try {
      if (!/^[0-9a-f]{64}$/.test(offerHash)) throw new Error();
      const url = `${this.#origin}${path}`;
      const response = await this.#session.fetch(url, {
        ...init,
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          Origin: this.#origin,
          ...init.headers,
        },
      });
      const declared = response.headers.get("content-length");
      const length =
        declared && /^[1-9][0-9]*$/.test(declared)
          ? Number(declared)
          : Number.NaN;
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        !response.headers
          .get("content-type")
          ?.trim()
          .toLowerCase()
          .startsWith("application/json") ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > STATUS_MAX_BYTES
      ) {
        throw new Error();
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength !== length) throw new Error();
      const status = exactStatus(
        JSON.parse(Buffer.from(body).toString("utf8")),
      );
      if (!same(status.offer, exactBytes(expectedOffer, OFFER_MAX_BYTES))) {
        throw new Error();
      }
      return status;
    } catch {
      throw new PrivateVaultContentEnrollmentTransportError();
    }
  }
}
