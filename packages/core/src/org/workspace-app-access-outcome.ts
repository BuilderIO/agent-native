export const WORKSPACE_APP_ACCESS_UNAVAILABLE = "unavailable" as const;
export const WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE =
  "Workspace app access is temporarily unavailable.";

const MAX_DETAIL_LENGTH = 160;

export type WorkspaceAppAccessUnavailableReason =
  | "directory-url-invalid"
  | "org-domain-lookup-failed"
  | "org-domain-missing"
  | "a2a-secret-missing"
  | "token-signing-failed"
  | "registry-timeout"
  | "registry-fetch-failed"
  | "registry-http-error"
  | "registry-malformed-response"
  | "claim-http-error"
  | "claim-malformed-response";

/**
 * The access check could not reach a verdict. Distinct from `false`: the
 * caller is not refused, the answer is unknown, and `reason` says which step
 * failed so a 503 can be traced without server logs.
 */
export interface WorkspaceAppAccessUnavailable {
  status: typeof WORKSPACE_APP_ACCESS_UNAVAILABLE;
  reason: WorkspaceAppAccessUnavailableReason;
  /** HTTP status of the Dispatch registry reply, when one arrived. */
  upstreamStatus?: number;
  /** Audience the caller signed for: origin and path only, never userinfo. */
  audience?: string;
  /** Short text from the upstream reply or error class. Untrusted. */
  detail?: string;
}

/** What `isWorkspaceAppAccessAllowed` has always returned. */
export type WorkspaceAppAccessOutcome =
  | boolean
  | typeof WORKSPACE_APP_ACCESS_UNAVAILABLE;

/** A verdict, or the cause when none could be reached. */
export type WorkspaceAppAccessCheck = boolean | WorkspaceAppAccessUnavailable;

export function isWorkspaceAppAccessUnavailable(
  outcome: unknown,
): outcome is WorkspaceAppAccessUnavailable {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { status?: unknown }).status ===
      WORKSPACE_APP_ACCESS_UNAVAILABLE
  );
}

export function workspaceAppAccessUnavailable(
  reason: WorkspaceAppAccessUnavailableReason,
  extra: Pick<
    WorkspaceAppAccessUnavailable,
    "upstreamStatus" | "audience" | "detail"
  > = {},
): WorkspaceAppAccessUnavailable {
  const detail = boundedDetail(extra.detail);
  return {
    status: WORKSPACE_APP_ACCESS_UNAVAILABLE,
    reason,
    ...(extra.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: extra.upstreamStatus }),
    ...(extra.audience ? { audience: extra.audience } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function workspaceAppAccessUnavailableBody(
  outcome: WorkspaceAppAccessUnavailable,
): {
  error: string;
  code: WorkspaceAppAccessUnavailableReason;
  upstreamStatus?: number;
  audience?: string;
  detail?: string;
} {
  return {
    error: WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
    code: outcome.reason,
    ...(outcome.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: outcome.upstreamStatus }),
    ...(outcome.audience ? { audience: outcome.audience } : {}),
    ...(outcome.detail ? { detail: outcome.detail } : {}),
  };
}

/**
 * Names a thrown error without echoing its message: driver and upstream
 * messages can carry hostnames or connection strings.
 */
export function describeFetchFailure(error: unknown): {
  timedOut: boolean;
  detail: string;
} {
  const name = error instanceof Error ? error.name : "UnknownError";
  const cause =
    error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const code =
    cause && typeof (cause as { code?: unknown }).code === "string"
      ? (cause as { code: string }).code
      : "";
  return {
    timedOut: name === "AbortError" || name === "TimeoutError",
    detail: code ? `${name}:${code}` : name,
  };
}

/**
 * Reads the human-readable refusal out of a registry error reply, if it sent
 * JSON. A non-JSON or unreadable body yields no detail; the HTTP status on the
 * outcome already says the call failed.
 */
export function registryErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const candidate of [
    record.error,
    record.statusMessage,
    record.message,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function boundedDetail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const collapsed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return undefined;
  return collapsed.length > MAX_DETAIL_LENGTH
    ? `${collapsed.slice(0, MAX_DETAIL_LENGTH)}…`
    : collapsed;
}
