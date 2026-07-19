import type { PrivateVaultContentSession } from "./content-genesis-transport.js";

const OBJECT_TYPE = "document";
const ALGORITHM_ID = "anc/v1";
const MAXIMUM_CIPHERTEXT_BYTES = 1024 * 1024 + 64 * 1024;
const MAXIMUM_METADATA_BYTES = 4096;
const MAXIMUM_INDEX_BYTES = 4 * 1024 * 1024;

export interface PrivateVaultContentObjectCoordinate {
  readonly vaultId: string;
  readonly objectId: string;
  readonly revisionId: string;
}

export interface PrivateVaultContentObjectMetadata extends PrivateVaultContentObjectCoordinate {
  readonly revision: number;
  readonly objectType: typeof OBJECT_TYPE;
  readonly algorithmId: typeof ALGORITHM_ID;
  readonly epoch: number;
  readonly parentRevisionIds: readonly string[];
  readonly ciphertextByteLength: number;
  readonly serverReceivedAt?: string;
}

export class PrivateVaultContentObjectTransportError extends Error {
  constructor() {
    super("Private Vault object transport unavailable");
    this.name = "PrivateVaultContentObjectTransportError";
  }
}

function exactOrigin(value: string): string {
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
    throw new PrivateVaultContentObjectTransportError();
  }
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function exactCoordinate(value: PrivateVaultContentObjectCoordinate) {
  if (
    !lowerHex(value.vaultId, 16) ||
    !lowerHex(value.objectId, 16) ||
    !lowerHex(value.revisionId, 32)
  )
    throw new PrivateVaultContentObjectTransportError();
  return value;
}

function encodeParents(values: readonly string[]): string {
  if (
    !Array.isArray(values) ||
    values.length > 32 ||
    values.some((value) => !lowerHex(value, 32))
  )
    throw new PrivateVaultContentObjectTransportError();
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

function parseMetadata(value: unknown): PrivateVaultContentObjectMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrivateVaultContentObjectTransportError();
  const record = value as Record<string, unknown>;
  const allowed = [
    "algorithmId",
    "ciphertextByteLength",
    "epoch",
    "objectId",
    "objectType",
    "parentRevisionIds",
    "revision",
    "revisionId",
    "serverReceivedAt",
    "vaultId",
  ];
  const keys = Object.keys(record).sort();
  if (
    keys.some((key) => !allowed.includes(key)) ||
    keys.length < 9 ||
    keys.length > 10 ||
    !lowerHex(record.vaultId, 16) ||
    !lowerHex(record.objectId, 16) ||
    !lowerHex(record.revisionId, 32) ||
    record.objectType !== OBJECT_TYPE ||
    record.algorithmId !== ALGORITHM_ID ||
    !positiveSafeInteger(record.revision) ||
    !positiveSafeInteger(record.epoch) ||
    !positiveSafeInteger(record.ciphertextByteLength) ||
    record.ciphertextByteLength > MAXIMUM_CIPHERTEXT_BYTES ||
    !Array.isArray(record.parentRevisionIds) ||
    record.parentRevisionIds.length > 32 ||
    record.parentRevisionIds.some((value) => !lowerHex(value, 32)) ||
    (record.serverReceivedAt !== undefined &&
      (typeof record.serverReceivedAt !== "string" ||
        Number.isNaN(Date.parse(record.serverReceivedAt))))
  )
    throw new PrivateVaultContentObjectTransportError();
  return Object.freeze({
    vaultId: record.vaultId,
    objectId: record.objectId,
    revisionId: record.revisionId,
    revision: record.revision,
    objectType: OBJECT_TYPE,
    algorithmId: ALGORITHM_ID,
    epoch: record.epoch,
    parentRevisionIds: [...record.parentRevisionIds] as string[],
    ciphertextByteLength: record.ciphertextByteLength,
    ...(typeof record.serverReceivedAt === "string"
      ? { serverReceivedAt: record.serverReceivedAt }
      : {}),
  });
}

function exactMetadata(
  value: unknown,
  expected: PrivateVaultContentObjectMetadata,
): PrivateVaultContentObjectMetadata {
  const parsed = parseMetadata(value);
  if (
    parsed.vaultId !== expected.vaultId ||
    parsed.objectId !== expected.objectId ||
    parsed.revisionId !== expected.revisionId ||
    parsed.revision !== expected.revision ||
    parsed.epoch !== expected.epoch ||
    parsed.ciphertextByteLength !== expected.ciphertextByteLength ||
    parsed.parentRevisionIds.length !== expected.parentRevisionIds.length ||
    parsed.parentRevisionIds.some(
      (value, index) => value !== expected.parentRevisionIds[index],
    )
  )
    throw new PrivateVaultContentObjectTransportError();
  return parsed;
}

async function boundedBytes(
  response: Response,
  maximum: number,
  expected?: number,
): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (
    length === null ||
    !/^[1-9][0-9]*$/.test(length) ||
    Number(length) > maximum ||
    (expected !== undefined && Number(length) !== expected)
  )
    throw new PrivateVaultContentObjectTransportError();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== Number(length))
    throw new PrivateVaultContentObjectTransportError();
  return bytes;
}

export class PrivateVaultContentObjectTransport {
  readonly #session: PrivateVaultContentSession;
  readonly #origin: string;

  constructor(input: {
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
  }) {
    this.#session = input.session;
    this.#origin = exactOrigin(input.origin);
  }

  async put(input: {
    readonly coordinate: PrivateVaultContentObjectCoordinate;
    readonly revision: number;
    readonly epoch: number;
    readonly parentRevisionIds?: readonly string[];
    readonly ciphertext: Uint8Array;
  }): Promise<PrivateVaultContentObjectMetadata> {
    const coordinate = exactCoordinate(input.coordinate);
    const parents = input.parentRevisionIds ?? [];
    if (
      !positiveSafeInteger(input.revision) ||
      !positiveSafeInteger(input.epoch)
    )
      throw new PrivateVaultContentObjectTransportError();
    const ciphertext = Uint8Array.from(input.ciphertext);
    if (
      ciphertext.byteLength === 0 ||
      ciphertext.byteLength > MAXIMUM_CIPHERTEXT_BYTES
    )
      throw new PrivateVaultContentObjectTransportError();
    const expected: PrivateVaultContentObjectMetadata = {
      ...coordinate,
      objectType: OBJECT_TYPE,
      algorithmId: ALGORITHM_ID,
      revision: input.revision,
      epoch: input.epoch,
      parentRevisionIds: [...parents],
      ciphertextByteLength: ciphertext.byteLength,
    };
    const body = Buffer.from(ciphertext);
    try {
      const url = `${this.#origin}/api/private-vault/objects`;
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "Content-Length": String(body.byteLength),
          "Content-Type": "application/octet-stream",
          "X-Agent-Native-CSRF": "1",
          "X-ANC-Vault-Id": coordinate.vaultId,
          "X-ANC-Object-Id": coordinate.objectId,
          "X-ANC-Revision-Id": coordinate.revisionId,
          "X-ANC-Revision": String(input.revision),
          "X-ANC-Object-Type": OBJECT_TYPE,
          "X-ANC-Algorithm-Id": ALGORITHM_ID,
          "X-ANC-Epoch": String(input.epoch),
          "X-ANC-Parent-Revision-Ids": encodeParents(parents),
          "X-ANC-Ciphertext-Byte-Length": String(body.byteLength),
        },
        body,
      });
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          "application/json"
      )
        throw new Error();
      const bytes = await boundedBytes(response, MAXIMUM_METADATA_BYTES);
      return exactMetadata(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        expected,
      );
    } catch {
      throw new PrivateVaultContentObjectTransportError();
    } finally {
      body.fill(0);
      ciphertext.fill(0);
    }
  }

  async list(vaultIdInput: string): Promise<
    readonly {
      readonly objectId: string;
      readonly objectType: typeof OBJECT_TYPE;
      readonly latestRevision: PrivateVaultContentObjectMetadata;
    }[]
  > {
    if (!lowerHex(vaultIdInput, 16))
      throw new PrivateVaultContentObjectTransportError();
    const vaultId = vaultIdInput;
    const url = `${this.#origin}/api/private-vault/objects`;
    try {
      const response = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "X-ANC-Vault-Id": vaultId,
        },
      });
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          "application/json"
      )
        throw new Error();
      const decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await boundedBytes(response, MAXIMUM_INDEX_BYTES),
        ),
      ) as unknown;
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        throw new Error();
      const envelope = decoded as Record<string, unknown>;
      if (
        Object.keys(envelope).length !== 1 ||
        !Array.isArray(envelope.objects) ||
        envelope.objects.length > 10_000
      )
        throw new Error();
      const objects = envelope.objects.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        const record = value as Record<string, unknown>;
        if (
          Object.keys(record).sort().join(",") !==
            "latestRevision,objectId,objectType" ||
          !lowerHex(record.objectId, 16) ||
          record.objectType !== OBJECT_TYPE
        )
          throw new Error();
        const latestRevision = parseMetadata(record.latestRevision);
        if (
          latestRevision.vaultId !== vaultId ||
          latestRevision.objectId !== record.objectId ||
          latestRevision.objectType !== record.objectType
        )
          throw new Error();
        return Object.freeze({
          objectId: record.objectId,
          objectType: OBJECT_TYPE,
          latestRevision,
        });
      });
      return Object.freeze(objects);
    } catch {
      throw new PrivateVaultContentObjectTransportError();
    }
  }

  async get(input: PrivateVaultContentObjectCoordinate): Promise<{
    readonly ciphertext: Uint8Array;
    readonly metadata: Omit<
      PrivateVaultContentObjectMetadata,
      "vaultId" | "objectId" | "revisionId" | "serverReceivedAt"
    >;
  }> {
    const coordinate = exactCoordinate(input);
    const url = `${this.#origin}/api/private-vault/objects/${coordinate.objectId}/${coordinate.revisionId}`;
    try {
      const response = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/octet-stream",
          "Cache-Control": "no-store",
          "X-ANC-Vault-Id": coordinate.vaultId,
        },
      });
      const length = Number(
        response.headers.get("x-anc-ciphertext-byte-length"),
      );
      const epoch = Number(response.headers.get("x-anc-epoch"));
      const revision = Number(response.headers.get("x-anc-revision"));
      const parentsHeader = response.headers.get("x-anc-parent-revision-ids");
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          "application/octet-stream" ||
        !positiveSafeInteger(length) ||
        length > MAXIMUM_CIPHERTEXT_BYTES ||
        !positiveSafeInteger(epoch) ||
        !positiveSafeInteger(revision) ||
        response.headers.get("x-anc-object-type") !== OBJECT_TYPE ||
        response.headers.get("x-anc-algorithm-id") !== ALGORITHM_ID ||
        !parentsHeader
      )
        throw new Error();
      const parents = JSON.parse(
        Buffer.from(parentsHeader, "base64url").toString("utf8"),
      ) as unknown;
      if (
        !Array.isArray(parents) ||
        parents.length > 32 ||
        parents.some((value) => !lowerHex(value, 32))
      )
        throw new Error();
      return Object.freeze({
        ciphertext: await boundedBytes(
          response,
          MAXIMUM_CIPHERTEXT_BYTES,
          length,
        ),
        metadata: Object.freeze({
          objectType: OBJECT_TYPE,
          algorithmId: ALGORITHM_ID,
          revision,
          epoch,
          parentRevisionIds: [...parents] as string[],
          ciphertextByteLength: length,
        }),
      });
    } catch {
      throw new PrivateVaultContentObjectTransportError();
    }
  }
}
