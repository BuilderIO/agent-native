const RUNTIME_PATH = "/api/private-vault/broker/runtime";
const MEDIA_TYPE = "application/json";
const MAXIMUM_RESPONSE_BYTES = 4096;

export class PrivateVaultContentBrokerRuntimeTransportError extends Error {
  constructor() {
    super("Private Vault broker runtime transport unavailable");
    this.name = "PrivateVaultContentBrokerRuntimeTransportError";
  }
}

export interface PrivateVaultContentBrokerRuntimeDescriptor {
  readonly version: 1;
  readonly suite: "anc/v1";
  readonly state: "active";
  readonly vaultId: string;
  readonly endpointId: string;
  readonly head: { readonly sequence: number; readonly hash: string };
}

interface ContentBrokerRuntimeSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

function exactOrigin(value: string): string {
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
    throw new PrivateVaultContentBrokerRuntimeTransportError();
  }
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function exactDescriptor(
  value: unknown,
): PrivateVaultContentBrokerRuntimeDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !==
      ["endpointId", "head", "state", "suite", "vaultId", "version"]
        .sort()
        .join("\0") ||
    record.version !== 1 ||
    record.suite !== "anc/v1" ||
    record.state !== "active" ||
    !lowerHex(record.vaultId, 16) ||
    !lowerHex(record.endpointId, 16) ||
    !record.head ||
    typeof record.head !== "object" ||
    Array.isArray(record.head)
  )
    throw new Error();
  const head = record.head as Record<string, unknown>;
  if (
    Object.keys(head).sort().join("\0") !== "hash\0sequence" ||
    !Number.isSafeInteger(head.sequence) ||
    (head.sequence as number) < 0 ||
    !lowerHex(head.hash, 32)
  )
    throw new Error();
  return Object.freeze({
    version: 1,
    suite: "anc/v1",
    state: "active",
    vaultId: record.vaultId,
    endpointId: record.endpointId,
    head: Object.freeze({ sequence: head.sequence as number, hash: head.hash }),
  });
}

export class PrivateVaultContentBrokerRuntimeTransport {
  readonly #session: ContentBrokerRuntimeSession;
  readonly #origin: string;

  constructor(input: { session: ContentBrokerRuntimeSession; origin: string }) {
    this.#session = input.session;
    this.#origin = exactOrigin(input.origin);
  }

  async read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor> {
    try {
      const url = `${this.#origin}${RUNTIME_PATH}`;
      const response = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: MEDIA_TYPE,
          "Cache-Control": "no-store",
          "X-Agent-Native-CSRF": "1",
        },
      });
      const length = response.headers.get("content-length");
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          MEDIA_TYPE ||
        length === null ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > MAXIMUM_RESPONSE_BYTES
      )
        throw new Error();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== Number(length)) throw new Error();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const descriptor = exactDescriptor(JSON.parse(text));
      if (JSON.stringify(descriptor) !== text) throw new Error();
      return descriptor;
    } catch {
      throw new PrivateVaultContentBrokerRuntimeTransportError();
    }
  }
}
