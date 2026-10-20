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

  // Intake action errors may follow a failed recording insert, so replaying
  // any structured action failure can leave another failed row behind.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    // coercion-ok: malformed JSON is ambiguous, so surface it without replaying the intake POST.
    return false;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return !("error" in body || "errorCode" in body || "details" in body);
}
