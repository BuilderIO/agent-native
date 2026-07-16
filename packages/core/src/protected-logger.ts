import { boundedProtocolTokenSchema } from "./e2ee/contracts.js";
import {
  protectedExecutionReceiptSchema,
  type ProtectedExecutionReceipt,
} from "./protected-execution-context.js";

export type ProtectedLogLevel = "debug" | "info" | "warn" | "error";

/**
 * The only logger permitted inside protected resolver and broker modules.
 * Its surface deliberately accepts no arbitrary fields, errors, prompts, or
 * values: hosted logs receive one bounded event token and one content-free
 * execution receipt, never protected arguments or results.
 */
export function logProtectedExecutionReceipt(input: {
  level: ProtectedLogLevel;
  event: string;
  receipt: ProtectedExecutionReceipt;
}): void {
  const event = boundedProtocolTokenSchema.parse(input.event);
  const receipt = protectedExecutionReceiptSchema.parse(input.receipt);
  console[input.level]("agent_native_protected_execution", { event, receipt });
}
