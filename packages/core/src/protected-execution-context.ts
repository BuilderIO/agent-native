import { z } from "zod";

import {
  boundedProtocolTokenSchema,
  contentFreeAccessEventSchema,
  E2EE_CONTRACT_VERSION,
  opaqueIdSchema,
} from "./e2ee/contracts.js";

type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
};

type AsyncLocalStorageCtor = new <T>() => AsyncLocalStorageLike<T>;

class StackAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
  private readonly stack: T[] = [];

  getStore(): T | undefined {
    return this.stack.at(-1);
  }

  run<R>(store: T, callback: () => R): R {
    this.stack.push(store);
    try {
      const result = callback();
      const maybePromise = result as unknown as
        | { finally?: (callback: () => void) => unknown }
        | undefined;
      if (maybePromise && typeof maybePromise.finally === "function") {
        return maybePromise.finally(() => {
          this.stack.pop();
        }) as R;
      }
      this.stack.pop();
      return result;
    } catch (error) {
      this.stack.pop();
      throw error;
    }
  }
}

function getAsyncLocalStorageCtor(): AsyncLocalStorageCtor | undefined {
  if (
    typeof window !== "undefined" ||
    typeof process === "undefined" ||
    !process.versions?.node ||
    typeof process.getBuiltinModule !== "function"
  ) {
    return undefined;
  }
  return process.getBuiltinModule("node:async_hooks")?.AsyncLocalStorage as
    | AsyncLocalStorageCtor
    | undefined;
}

export const protectedExecutionReceiptSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    actionName: boundedProtocolTokenSchema,
    resourceType: boundedProtocolTokenSchema,
    placement: z.enum(["trusted_endpoint", "enrolled_broker"]),
    status: z.enum(["executed", "queued", "denied"]),
    operationId: opaqueIdSchema.optional(),
    queueId: opaqueIdSchema.optional(),
    accessEvent: contentFreeAccessEventSchema.optional(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    if ((receipt.status === "queued") !== (receipt.queueId !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queueId"],
        message: "Queued receipts require queueId and other receipts forbid it",
      });
    }
  });

export type ProtectedExecutionReceipt = z.infer<
  typeof protectedExecutionReceiptSchema
>;

function deepFreeze<TValue>(value: TValue): TValue {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function canonicalReceipt(
  receiptInput: ProtectedExecutionReceipt,
): ProtectedExecutionReceipt {
  return deepFreeze(protectedExecutionReceiptSchema.parse(receiptInput));
}

export interface ProtectedExecutionContext {
  readonly receipt: ProtectedExecutionReceipt;
  readonly disclosed: boolean;
}

interface MutableProtectedExecutionContext {
  receipt: ProtectedExecutionReceipt;
  disclosed: boolean;
}

const GLOBAL_CONTEXT_KEY = "__agentNativeProtectedExecutionAls" as const;
type GlobalWithProtectedContext = typeof globalThis & {
  [GLOBAL_CONTEXT_KEY]?: AsyncLocalStorageLike<MutableProtectedExecutionContext>;
};
const globalRef = globalThis as GlobalWithProtectedContext;
if (!globalRef[GLOBAL_CONTEXT_KEY]) {
  const Ctor = getAsyncLocalStorageCtor();
  globalRef[GLOBAL_CONTEXT_KEY] = Ctor
    ? new Ctor<MutableProtectedExecutionContext>()
    : new StackAsyncLocalStorage<MutableProtectedExecutionContext>();
}
const protectedExecutionStorage = globalRef[GLOBAL_CONTEXT_KEY]!;

export function runWithProtectedExecutionContext<TResult>(
  receiptInput: ProtectedExecutionReceipt,
  callback: () => TResult,
): TResult {
  const receipt = canonicalReceipt(receiptInput);
  return protectedExecutionStorage.run({ receipt, disclosed: false }, callback);
}

export function getProtectedExecutionContext():
  | Readonly<ProtectedExecutionContext>
  | undefined {
  return protectedExecutionStorage.getStore();
}

export function markProtectedDisclosure(): boolean {
  const context = protectedExecutionStorage.getStore();
  if (!context) return false;
  context.disclosed = true;
  return true;
}

const DELIVERY_TOKEN = Symbol("protected-delivery-adapter");
export const PROTECTED_DELIVERY_CAPABILITY = "protected:deliver" as const;

export interface ProtectedDeliveryAdapterAuthorization {
  readonly adapterId: string;
  readonly capabilities: readonly string[];
  readonly [DELIVERY_TOKEN]: true;
}

export function authorizeProtectedDeliveryAdapter(input: {
  adapterId: string;
  capabilities: readonly string[];
}): ProtectedDeliveryAdapterAuthorization {
  const adapterId = boundedProtocolTokenSchema.parse(input.adapterId);
  const capabilities = Object.freeze(
    z
      .array(boundedProtocolTokenSchema)
      .max(64)
      .parse(
        Array.from(
          new Set(
            input.capabilities.map((value) => value.trim()).filter(Boolean),
          ),
        ),
      ),
  );
  if (!capabilities.includes(PROTECTED_DELIVERY_CAPABILITY)) {
    throw new Error("Protected delivery capability is required");
  }
  return Object.freeze({
    adapterId,
    capabilities,
    [DELIVERY_TOKEN]: true as const,
  });
}

function isAuthorizedDeliveryAdapter(
  value: unknown,
): value is ProtectedDeliveryAdapterAuthorization {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProtectedDeliveryAdapterAuthorization>;
  return (
    candidate[DELIVERY_TOKEN] === true &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.includes(PROTECTED_DELIVERY_CAPABILITY)
  );
}

export class ProtectedTransientValue<TValue> {
  readonly receipt: ProtectedExecutionReceipt;
  readonly #value: TValue;

  constructor(value: TValue, receiptInput: ProtectedExecutionReceipt) {
    this.receipt = canonicalReceipt(receiptInput);
    this.#value = value;
    Object.freeze(this);
  }

  toJSON(): { protected: true; receipt: ProtectedExecutionReceipt } {
    return { protected: true, receipt: this.receipt };
  }

  deliver<TResult>(
    authorization: ProtectedDeliveryAdapterAuthorization,
    callback: (value: TValue) => TResult,
  ): TResult {
    if (!isAuthorizedDeliveryAdapter(authorization)) {
      throw new Error("Authorized protected delivery adapter is required");
    }
    if (typeof callback !== "function") {
      throw new Error("Protected delivery callback is required");
    }
    return runWithProtectedExecutionContext(this.receipt, () => {
      markProtectedDisclosure();
      return callback(this.#value);
    });
  }
}
