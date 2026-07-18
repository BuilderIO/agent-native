import { E2EE_SIZE_LIMITS } from "@agent-native/core/e2ee";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const ACTION_NAME = /^[a-z][a-z0-9-]{0,119}$/;
const MAX_DEPTH = 32;
const MAX_NODES = 100_000;

export class PrivateVaultActionExecutorError extends Error {
  constructor() {
    super("Private Vault action execution failed");
    this.name = "PrivateVaultActionExecutorError";
  }
}

export interface PrivateVaultActionRequest {
  readonly version: 1;
  readonly type: "content-action";
  readonly actionName: string;
  readonly args: unknown;
}

export interface PrivateVaultAuthorizedActionContext {
  readonly jobId: string;
  readonly resourceId: Uint8Array;
  readonly operation: string;
}

export interface PrivateVaultLocalActionHandler {
  run(
    args: unknown,
    context: PrivateVaultAuthorizedActionContext,
  ): Promise<unknown> | unknown;
}

export type PrivateVaultLocalActionRegistry = Readonly<
  Record<string, PrivateVaultLocalActionHandler>
>;

function fail(): never {
  throw new PrivateVaultActionExecutorError();
}

function plainJson(value: unknown, depth = 0, count = { value: 0 }): unknown {
  count.value += 1;
  if (depth > MAX_DEPTH || count.value > MAX_NODES) fail();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainJson(item, depth + 1, count));
  }
  if (!value || typeof value !== "object") fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      fail();
    }
    output[key] = plainJson(
      (value as Record<string, unknown>)[key],
      depth + 1,
      count,
    );
  }
  return output;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== [...expected].sort()[index])
  ) {
    fail();
  }
}

export function encodePrivateVaultActionRequest(input: {
  readonly actionName: string;
  readonly args: unknown;
}): Uint8Array {
  if (!ACTION_NAME.test(input.actionName)) fail();
  const encoded = encoder.encode(
    JSON.stringify({
      version: 1,
      type: "content-action",
      actionName: input.actionName,
      args: plainJson(input.args),
    }),
  );
  if (encoded.byteLength > E2EE_SIZE_LIMITS.jobPayloadBytes) fail();
  return encoded;
}

export function decodePrivateVaultActionRequest(
  encoded: Uint8Array,
): PrivateVaultActionRequest {
  try {
    if (
      !(encoded instanceof Uint8Array) ||
      encoded.byteLength === 0 ||
      encoded.byteLength > E2EE_SIZE_LIMITS.jobPayloadBytes
    ) {
      fail();
    }
    const text = decoder.decode(encoded);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail();
    const record = parsed as Record<string, unknown>;
    exactKeys(record, ["actionName", "args", "type", "version"]);
    if (
      record.version !== 1 ||
      record.type !== "content-action" ||
      typeof record.actionName !== "string" ||
      !ACTION_NAME.test(record.actionName)
    ) {
      fail();
    }
    const result = {
      version: 1 as const,
      type: "content-action" as const,
      actionName: record.actionName,
      args: plainJson(record.args),
    };
    if (
      text !==
      JSON.stringify({
        version: result.version,
        type: result.type,
        actionName: result.actionName,
        args: result.args,
      })
    ) {
      fail();
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof PrivateVaultActionExecutorError) throw error;
    return fail();
  }
}

function encodeResult(ok: boolean, value: unknown): Uint8Array {
  const encoded = encoder.encode(
    JSON.stringify(
      ok
        ? {
            version: 1,
            type: "content-action-result",
            ok: true,
            result: plainJson(value),
          }
        : {
            version: 1,
            type: "content-action-result",
            ok: false,
            error: "action_failed",
          },
    ),
  );
  if (encoded.byteLength > E2EE_SIZE_LIMITS.resultPayloadBytes) fail();
  return encoded;
}

/**
 * Executes only a registered Content action whose exact name was authenticated
 * by the native semantic-job boundary. No URL, module name, shell command, SQL,
 * or renderer callback is accepted from the encrypted body.
 */
export class PrivateVaultContentActionExecutor {
  readonly #registry: PrivateVaultLocalActionRegistry;

  constructor(registry: PrivateVaultLocalActionRegistry) {
    const copy: Record<string, PrivateVaultLocalActionHandler> =
      Object.create(null);
    for (const [name, handler] of Object.entries(registry)) {
      if (
        !ACTION_NAME.test(name) ||
        !handler ||
        typeof handler.run !== "function"
      ) {
        fail();
      }
      copy[name] = handler;
    }
    this.#registry = Object.freeze(copy);
  }

  async execute(input: {
    readonly payload: Uint8Array;
    readonly jobId: string;
    readonly resourceId: Uint8Array;
    readonly operation: string;
  }): Promise<{
    readonly state: "completed" | "failed";
    readonly payload: Uint8Array;
  }> {
    try {
      if (!ACTION_NAME.test(input.operation)) {
        fail();
      }
      const request = decodePrivateVaultActionRequest(input.payload);
      if (request.actionName !== input.operation) fail();
      const handler = this.#registry[request.actionName];
      if (!handler) fail();
      const result = await handler.run(request.args, {
        jobId: input.jobId,
        resourceId: Uint8Array.from(input.resourceId),
        operation: input.operation,
      });
      return { state: "completed", payload: encodeResult(true, result) };
    } catch {
      return { state: "failed", payload: encodeResult(false, null) };
    }
  }
}
