const RUNTIME_PATH = "/api/private-vault/runtime";
const MAXIMUM_RESPONSE_BYTES = 4096;

export interface PrivateVaultContentRuntimeDescriptor {
  readonly version: 1;
  readonly suite: "anc/v1";
  readonly state: "active";
  readonly vaultId: string;
  readonly head: { readonly sequence: number; readonly hash: string };
}

export class PrivateVaultContentRuntimeTransportError extends Error {
  constructor() {
    super("Private Content runtime transport unavailable");
    this.name = "PrivateVaultContentRuntimeTransportError";
  }
}

interface RuntimeSession {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
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
    throw new PrivateVaultContentRuntimeTransportError();
  }
}

function descriptor(value: unknown): PrivateVaultContentRuntimeDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\0") !==
      "head\0state\0suite\0vaultId\0version" ||
    record.version !== 1 ||
    record.suite !== "anc/v1" ||
    record.state !== "active" ||
    !lowerHex(record.vaultId, 16) ||
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
    head: Object.freeze({ sequence: head.sequence as number, hash: head.hash }),
  });
}

export class PrivateVaultContentRuntimeTransport {
  readonly #origin: string;
  readonly #session: RuntimeSession;

  constructor(input: { origin: string; session: RuntimeSession }) {
    this.#origin = origin(input.origin);
    this.#session = input.session;
  }

  async read(): Promise<PrivateVaultContentRuntimeDescriptor> {
    try {
      const url = `${this.#origin}${RUNTIME_PATH}`;
      const response = await this.#session.fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
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
          "application/json" ||
        length === null ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > MAXIMUM_RESPONSE_BYTES
      )
        throw new Error();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== Number(length)) throw new Error();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = descriptor(JSON.parse(text));
      if (JSON.stringify(parsed) !== text) throw new Error();
      return parsed;
    } catch {
      throw new PrivateVaultContentRuntimeTransportError();
    }
  }
}
