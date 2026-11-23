import { readdirSync } from "node:fs";

const e2eFiles = new Set(
  readdirSync(new URL(".", import.meta.url), {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (entry) => entry.isFile() && /^[a-z0-9][a-z0-9.-]*\.ts$/.test(entry.name),
    )
    .map((entry) => entry.name),
);

export function safeErrorDiagnostic(error: unknown): string {
  const seen = new Set<unknown>();
  let remaining = 20;
  function format(value: unknown, depth: number): string {
    if (remaining-- <= 0 || depth > 5) return "[truncated]";
    if (value instanceof Error) {
      if (seen.has(value)) return "[cyclic cause]";
      seen.add(value);
      const children = value instanceof AggregateError ? value.errors : [];
      const causes =
        value.cause === undefined ? children : [...children, value.cause];
      const details = causes
        .slice(0, Math.max(0, remaining))
        .map((cause) => format(cause, depth + 1));
      if (details.length < causes.length) details.push("[truncated]");
      const own = safeErrorLeaf(value);
      return details.length ? `${own} [${details.join("; ")}]` : own;
    }
    return safeErrorLeaf(value);
  }
  return format(error, 0);
}

function safeErrorLeaf(error: unknown): string {
  const name =
    error instanceof Error &&
    [
      "Error",
      "AggregateError",
      "TimeoutError",
      "AssertionError",
      "TypeError",
    ].includes(error.name)
      ? error.name
      : "Error";
  const message = error instanceof Error ? error.message : "";
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    ["EEXIST", "ECONNREFUSED", "ESRCH", "ENOENT", "EACCES"].includes(error.code)
      ? error.code
      : undefined;
  const timeout = message.match(
    /^([a-zA-Z][a-zA-Z.]*): Timeout (\d+)ms exceeded\b/,
  );
  const urlAssertionTimeout = message.startsWith(
    "expect(page).toHaveURL(expected) failed\n\n",
  )
    ? message.split("\n\nCall log:", 1)[0]?.match(/^Timeout:  ?(\d+)ms$/m)
    : undefined;
  const location =
    error instanceof Error && error.stack
      ? Array.from(
          error.stack.matchAll(
            /\be2e\/(?:[a-z0-9-]+\/)*([a-z0-9][a-z0-9.-]*\.ts):(\d+):\d+/g,
          ),
        ).find((match) => match[1] !== undefined && e2eFiles.has(match[1]))
      : undefined;
  const suffix = location ? ` at ${location[1]}:${location[2]}` : "";
  if (code) return `${name}: ${code}${suffix}`;
  if (timeout) return `${name}: ${timeout[1]} timeout ${timeout[2]}ms${suffix}`;
  if (urlAssertionTimeout)
    return `${name}: expect(page).toHaveURL timeout ${urlAssertionTimeout[1]}ms${suffix}`;
  if (message.startsWith("expect("))
    return `${name}: details withheld${suffix}`;
  const status = message.match(/\bHTTP (\d{3})\b/);
  return status
    ? `${name}: HTTP ${status[1]}${suffix}`
    : `${name}: details withheld${suffix}`;
}

const knownRoutes = new Set([
  "/_agent-native/webmcp/manifest",
  "/_agent-native/connection-status/builder",
  "/_agent-native/agent-model-defaults",
  "/_agent-native/env-status",
  "/_agent-native/agent-loop-settings",
  "/_agent-native/agent-engine/status",
  "/_agent-native/agent-engine/ollama-models",
]);

const errorCodes = new Set([
  "data_connection_unavailable",
  "workspace_required",
  "workspace_membership_required",
  "workspace_access_denied",
  "data_connection_admin_required",
  "data_connection_not_found",
  "data_connection_read_denied",
  "ui_capability_required",
  "ui_only_action",
  "signed_in_browser_required",
  "workspace_credential_forbidden",
  "forbidden",
  "unauthorized",
  "access_denied",
  "connection_required",
  "output_contract_violation",
  "data_catalog_access_denied",
  "data_catalog_refresh_denied",
  "data_catalog_scope_root_only",
  "data_catalog_cursor_stale",
  "data_catalog_source_changed",
  "data_catalog_refresh_in_progress",
  "data_catalog_refresh_cursor_stuck",
  "data_catalog_refresh_incomplete",
  "data_catalog_refresh_failed",
  "data_catalog_refresh_aborted",
  "data_catalog_snapshot_corrupt",
  "data_catalog_transactions_unavailable",
  "data_catalog_state_persist_failed",
  "data_catalog_cleanup_failed",
  "data_connection_ai_disabled",
  "data_connection_not_connected",
  "data_connection_deleted",
  "data_connection_deleting",
]);

export function typedCode(body: unknown): string {
  if (body === undefined) return "body_unreadable";
  if (typeof body !== "object" || body === null) return "code_absent";
  const data = "data" in body ? body.data : undefined;
  const code =
    "errorCode" in body
      ? body.errorCode
      : typeof data === "object" && data !== null && "errorCode" in data
        ? data.errorCode
        : undefined;
  if (code === undefined) return "code_absent";
  return typeof code === "string" && errorCodes.has(code)
    ? code
    : "code_unrecognized";
}

export function warehouseFailureCode(body: string | undefined): string {
  if (body === undefined) return "body_unreadable";
  if (body.length === 0) return "body_empty";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "body_malformed";
  }
  const code = typedCode(parsed);
  return [
    "ui_capability_required",
    "ui_only_action",
    "signed_in_browser_required",
    "workspace_credential_forbidden",
    "code_absent",
  ].includes(code)
    ? code
    : "code_unrecognized";
}

// Only native connection IDs and known flow stages may leave request context.
export function failureDiagnostic(
  action: string | undefined,
  method: string,
  status: number,
  body: unknown,
  observedAt = new Date().toISOString(),
  path?: string,
  context?: {
    connectionId?: string | null | undefined;
    stage?: string | undefined;
  },
): string {
  return JSON.stringify({
    observedAt,
    action:
      action && /^[a-z][a-z0-9-]{0,100}$/.test(action) ? action : "non-action",
    ...(path && knownRoutes.has(path) ? { route: path } : {}),
    method: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ].includes(method)
      ? method
      : "unknown",
    status,
    errorCode: typedCode(body),
    ...(context?.connectionId &&
    /^wconn1:[a-f0-9]{64}$/.test(context.connectionId)
      ? { connectionId: context.connectionId }
      : {}),
    ...([
      "fill form",
      "create connection",
      "browse catalog",
      "run fixture query",
      "cleanup",
    ].includes(context?.stage ?? "")
      ? { stage: context?.stage }
      : {}),
  });
}
