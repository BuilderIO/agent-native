import { isActionContractError } from "@agent-native/core/action";
import { z } from "zod";

import { WarehouseExecutionError } from "./sql-adapter.js";

export const providerDiagnosticSchema = z.strictObject({
  reason: z.string().max(80),
  message: z.string().max(1500).nullable(),
  line: z.int().positive().nullable(),
  column: z.int().positive().nullable(),
});
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;
export const runFailureMessageSchema = z.string().trim().min(1).max(1500);

export const bigQueryFailureMessage =
  "BigQuery could not finish the query. Try running it again.";

function maskQueryValues(message: string) {
  return message.replace(/'(?:\\.|''|[^'])*'|"(?:\\.|""|[^"])*"|`[^`]*`/g, "?");
}

export function notebookBigQueryFailureMessage(error: unknown) {
  const provider =
    error instanceof WarehouseExecutionError
      ? error.provider
      : isActionContractError(error)
        ? {
            reason: error.details?.providerReason,
            message: error.message,
          }
        : undefined;
  const message = provider?.message?.trim().slice(0, 1500);
  if (!message) return bigQueryFailureMessage;
  return provider?.reason === "invalidQuery"
    ? maskQueryValues(message)
    : message;
}

export function notebookFailureMessage(
  error: unknown,
  code: string,
  provider: ProviderDiagnostic | undefined,
  kernelMessage: string | undefined,
): string {
  const message = provider
    ? (provider.message ?? provider.reason)
    : (kernelMessage ??
      (error instanceof Error && !error.message.startsWith("Failed query:")
        ? error.message
        : undefined));
  return message?.trim().slice(0, 1500) || code;
}

export function notebookProviderDiagnostic(
  error: unknown,
  sourceMapped: boolean,
): ProviderDiagnostic | undefined {
  const provider =
    error instanceof WarehouseExecutionError
      ? error.provider
      : isActionContractError(error) &&
          (error.errorCode.startsWith("warehouse_") ||
            error.errorCode.startsWith("bigquery_"))
        ? {
            reason:
              typeof error.details?.providerReason === "string"
                ? error.details.providerReason
                : typeof error.details?.grpcStatus === "number"
                  ? `grpc_${error.details.grpcStatus}`
                  : error.errorCode,
            message: error.message,
          }
        : undefined;
  if (!provider) return undefined;
  const message = provider.message;
  const missingName = message?.match(
    /^Unrecognized name: ([\w.]{1,128})(?=\s|;|$)/i,
  );
  const position = sourceMapped
    ? message?.match(/\[(\d{1,7}):(\d{1,7})\]\s*$/)
    : null;
  const reason = /^[\w-]{1,80}$/.test(provider.reason)
    ? provider.reason
    : "provider_error";
  const firstLine = message?.trim().split("\n", 1)[0];
  const queryMessage =
    reason === "invalidQuery" && firstLine
      ? maskQueryValues(firstLine).slice(0, 1500)
      : null;
  return {
    reason,
    message: missingName?.[0] ?? queryMessage,
    line: position ? Number(position[1]) || null : null,
    column: position ? Number(position[2]) || null : null,
  };
}
