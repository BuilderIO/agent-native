export type TrackingFailureCategory =
  | "cancelled"
  | "timeout"
  | "network_error"
  | "http_error"
  | "error";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function numericStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function isNetworkTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = errorName(error);
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    name === "NetworkError" ||
    name === "FetchError" ||
    [
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
      "ERR_NETWORK",
    ].includes(code)
  );
}

export function classifyTrackingFailure(
  error: unknown,
): TrackingFailureCategory {
  const name = errorName(error);
  if (
    name === "AbortError" ||
    name === "CancelledError" ||
    name === "CanceledError"
  ) {
    return "cancelled";
  }
  if (name === "TimeoutError" || name === "ConnectTimeoutError") {
    return "timeout";
  }
  const status = numericStatus(error);
  if (status !== undefined && status >= 400 && status < 600) {
    return "http_error";
  }
  if (isNetworkTransportError(error)) return "network_error";
  return "error";
}
