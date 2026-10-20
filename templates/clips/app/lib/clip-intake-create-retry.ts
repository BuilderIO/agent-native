const RETRYABLE_INTAKE_CREATE_STATUSES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);
export const INTAKE_CREATE_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

export async function shouldRetryIntakeCreateResponse(
  response: Response,
): Promise<boolean> {
  if (!RETRYABLE_INTAKE_CREATE_STATUSES.has(response.status)) return false;

  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (
    !contentType ||
    (!contentType.includes("application/json") &&
      !contentType.includes("+json"))
  ) {
    return true;
  }

  // Intake action errors may follow a failed recording insert. Retry only
  // typed failures that the server marked retryable after cleaning that row.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    // coercion-ok: non-JSON gateways fall back to status-based transient retries.
    return true;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const details = "details" in body ? body.details : undefined;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const retryable = (details as { retryable?: unknown }).retryable;
    if (typeof retryable === "boolean") return retryable;
  }
  return !("error" in body || "errorCode" in body || "details" in body);
}
