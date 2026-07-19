import { verifyAncV1BrokerDisclosure } from "@agent-native/core/e2ee";

const PATH = "/api/private-vault/disclosures";
const MAXIMUM_RESPONSE_BYTES = 256 * 1024;
const HEX_16 = /^[0-9a-f]{32}$/;
const TOKEN = /^[\x21-\x7e]{1,160}$/;

export class PrivateVaultContentDisclosureTransportError extends Error {
  constructor() {
    super("Private Content disclosure activity unavailable");
    this.name = "PrivateVaultContentDisclosureTransportError";
  }
}

interface DisclosureSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface PrivateVaultHostedDisclosure {
  readonly disclosureId: string;
  readonly vaultId: string;
  readonly endpointId: string;
  readonly jobId: string;
  readonly grantId: string;
  readonly resourceId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly destination: string;
  readonly outcome: "allowed" | "failed";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly serverReceivedAt: string;
  readonly signedEnvelope: Uint8Array;
}

export interface PrivateVaultVerifiedDisclosureActivity {
  readonly disclosureId: string;
  readonly endpointId: string;
  readonly jobId: string;
  readonly grantId: string;
  readonly resourceId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly destination: string;
  readonly outcome: "allowed" | "failed";
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly serverReceivedAt: string;
}

function origin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw new PrivateVaultContentDisclosureTransportError();
  }
}

function iso(value: unknown): string {
  if (typeof value !== "string") throw new Error();
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  )
    throw new Error();
  return value;
}

function envelope(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,87384}$/.test(value))
    throw new Error();
  const bytes = Buffer.from(value, "base64url");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > 64 * 1024 ||
    bytes.toString("base64url") !== value
  )
    throw new Error();
  return bytes;
}

function row(value: unknown): PrivateVaultHostedDisclosure {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !==
      "destination\0disclosureId\0endpointId\0expiresAt\0grantId\0issuedAt\0jobId\0operation\0outcome\0providerId\0resourceId\0serverReceivedAt\0signedEnvelope\0vaultId" ||
    !HEX_16.test(String(record.disclosureId)) ||
    !HEX_16.test(String(record.vaultId)) ||
    !HEX_16.test(String(record.endpointId)) ||
    !HEX_16.test(String(record.jobId)) ||
    !HEX_16.test(String(record.grantId)) ||
    !HEX_16.test(String(record.resourceId)) ||
    !TOKEN.test(String(record.operation)) ||
    !TOKEN.test(String(record.providerId)) ||
    !TOKEN.test(String(record.destination)) ||
    (record.outcome !== "allowed" && record.outcome !== "failed")
  )
    throw new Error();
  return Object.freeze({
    disclosureId: record.disclosureId as string,
    vaultId: record.vaultId as string,
    endpointId: record.endpointId as string,
    jobId: record.jobId as string,
    grantId: record.grantId as string,
    resourceId: record.resourceId as string,
    operation: record.operation as string,
    providerId: record.providerId as string,
    destination: record.destination as string,
    outcome: record.outcome,
    issuedAt: iso(record.issuedAt),
    expiresAt: iso(record.expiresAt),
    serverReceivedAt: iso(record.serverReceivedAt),
    signedEnvelope: envelope(record.signedEnvelope),
  });
}

function response(value: unknown): readonly PrivateVaultHostedDisclosure[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !== "disclosures\0suite\0version" ||
    record.version !== 1 ||
    record.suite !== "anc/v1" ||
    !Array.isArray(record.disclosures) ||
    record.disclosures.length > 50
  )
    throw new Error();
  const rows = record.disclosures.map(row);
  if (new Set(rows.map((item) => item.disclosureId)).size !== rows.length)
    throw new Error();
  return Object.freeze(rows);
}

export async function verifyPrivateVaultDisclosureActivity(input: {
  readonly vaultId: string;
  readonly brokerSigningPublicKey: Uint8Array;
  readonly rows: readonly PrivateVaultHostedDisclosure[];
}): Promise<readonly PrivateVaultVerifiedDisclosureActivity[]> {
  if (
    !HEX_16.test(input.vaultId) ||
    !(input.brokerSigningPublicKey instanceof Uint8Array) ||
    input.brokerSigningPublicKey.byteLength !== 32
  )
    throw new PrivateVaultContentDisclosureTransportError();
  try {
    return Object.freeze(
      await Promise.all(
        input.rows.map(async (item) => {
          if (item.vaultId !== input.vaultId) throw new Error();
          const issuedAt = Date.parse(item.issuedAt) / 1000;
          const expiresAt = Date.parse(item.expiresAt) / 1000;
          if (
            !Number.isSafeInteger(issuedAt) ||
            !Number.isSafeInteger(expiresAt) ||
            expiresAt <= issuedAt
          )
            throw new Error();
          const verified = await verifyAncV1BrokerDisclosure({
            request: {
              version: 1,
              suite: "anc/v1",
              type: "broker-disclosure-request",
              vaultId: item.vaultId,
              endpointId: item.endpointId,
              jobId: item.jobId,
              grantId: item.grantId,
              resourceId: item.resourceId,
              operation: item.operation,
              providerId: item.providerId,
              destination: item.destination,
              outcome: item.outcome,
              signedEnvelope: item.signedEnvelope,
            },
            brokerSigningPublicKey: input.brokerSigningPublicKey,
            nowSeconds: issuedAt,
          });
          if (
            verified.disclosureId !== item.disclosureId ||
            verified.issuedAt !== issuedAt ||
            verified.expiresAt !== expiresAt
          )
            throw new Error();
          return Object.freeze({
            disclosureId: verified.disclosureId,
            endpointId: item.endpointId,
            jobId: item.jobId,
            grantId: item.grantId,
            resourceId: item.resourceId,
            operation: verified.operation,
            providerId: verified.providerId,
            destination: verified.destination,
            outcome: item.outcome,
            issuedAt: verified.issuedAt,
            expiresAt: verified.expiresAt,
            serverReceivedAt: item.serverReceivedAt,
          });
        }),
      ),
    );
  } catch {
    throw new PrivateVaultContentDisclosureTransportError();
  }
}

export class PrivateVaultContentDisclosureTransport {
  readonly #origin: string;
  readonly #session: DisclosureSession;

  constructor(input: { origin: string; session: DisclosureSession }) {
    this.#origin = origin(input.origin);
    this.#session = input.session;
  }

  async list(
    vaultId: string,
  ): Promise<readonly PrivateVaultHostedDisclosure[]> {
    if (!HEX_16.test(vaultId))
      throw new PrivateVaultContentDisclosureTransportError();
    const url = `${this.#origin}${PATH}`;
    try {
      const result = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": vaultId,
        },
      });
      const length = result.headers.get("content-length");
      if (
        result.status !== 200 ||
        result.url !== url ||
        result.redirected ||
        result.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          "application/json" ||
        length === null ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > MAXIMUM_RESPONSE_BYTES
      )
        throw new Error();
      const bytes = new Uint8Array(await result.arrayBuffer());
      if (bytes.byteLength !== Number(length)) throw new Error();
      const parsed = response(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (parsed.some((item) => item.vaultId !== vaultId)) throw new Error();
      return parsed;
    } catch {
      throw new PrivateVaultContentDisclosureTransportError();
    }
  }
}
