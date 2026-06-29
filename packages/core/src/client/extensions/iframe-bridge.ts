const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

const BLOCKED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Path allowlist for the extension postMessage bridge.
 *
 * Extensions can only call paths under `/_agent-native/*` (the framework's own
 * namespace). Template-defined `/api/*` routes are intentionally rejected:
 * those routes are written by app authors who may not consistently apply the
 * `accessFilter`/`assertAccess` access scoping helpers. A shared/org extension
 * running with the viewer's session should not be able to reach surfaces
 * outside the framework's own well-audited namespace.
 *
 * If a template needs a extension to reach a custom route, expose it via an
 * action (`defineAction` auto-mounts under `/_agent-native/actions/<name>`).
 */
export function isAllowedExtensionPath(
  path: string,
  extensionId: string,
): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("\0")) return false;

  let pathname: string;
  try {
    const parsed = new URL(path, "http://agent-native.local");
    if (parsed.origin !== "http://agent-native.local") return false;
    pathname = parsed.pathname;
  } catch {
    return false;
  }

  const rawPathname = path.split("?")[0].split("#")[0];
  if (pathname !== rawPathname || pathname.includes("..")) return false;

  if (pathname.startsWith("/_agent-native/actions/")) return true;
  if (pathname.startsWith("/_agent-native/application-state/")) return true;

  if (pathname === "/_agent-native/extensions/proxy") return true;
  if (pathname === "/_agent-native/extensions/sql/query") return true;
  if (pathname === "/_agent-native/extensions/sql/exec") return true;

  const parts = pathname.split("/");
  if (
    parts.length >= 6 &&
    parts.length <= 7 &&
    parts[1] === "_agent-native" &&
    parts[2] === "extensions" &&
    parts[3] === "data"
  ) {
    try {
      return decodeURIComponent(parts[4]) === extensionId;
    } catch {
      return false;
    }
  }

  return false;
}

export function sanitizeExtensionRequestOptions(value: unknown): RequestInit {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const method =
    typeof raw.method === "string" && raw.method.trim()
      ? raw.method.toUpperCase()
      : "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error("Extension request method is not allowed");
  }

  const headers =
    raw.headers && typeof raw.headers === "object"
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>)
            .filter(([key, val]) => isAllowedHeader(key) && val !== undefined)
            .map(([key, val]) => [key, String(val)]),
        )
      : undefined;
  const body =
    typeof raw.body === "string" ||
    raw.body instanceof Blob ||
    raw.body instanceof FormData
      ? raw.body
      : raw.body === undefined
        ? undefined
        : JSON.stringify(raw.body);

  return {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  };
}

function isAllowedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return HEADER_NAME_RE.test(name) && !BLOCKED_HEADERS.has(lower);
}

// ---------------------------------------------------------------------------
// Role-aware bridge gating (audit H4)
// ---------------------------------------------------------------------------
//
// The host bridge dispatches every iframe postMessage request with the
// viewer's session cookie. That means a non-author viewer's session can be
// used to call mutating actions, write SQL, and resolve secret references —
// the very capabilities that motivate the C1 consent step. After consent has
// been granted, we still want defense-in-depth: a viewer whose role is
// "viewer" should not be able to (e.g.) chain `appAction('share-resource')`
// or run `dbExec` writes against their own data through someone else's extension.
//
// Role table (lowest tier first):
//
//   role     | appFetch        | extensionFetch       | extensionData       | dbQuery | dbExec | appAction
//   ---------|-----------------|-----------------|----------------|---------|--------|----------
//   viewer   | GET only        | GET only        | get/list only  |  deny   |  deny  | allow*
//   editor   | all methods     | all methods     | get/list/set/  |  allow  | allow* |  allow
//            |                 |                 | remove         |         |        |
//   admin    | all methods     | all methods     | all            |  allow  | allow* |  allow
//   owner    | all methods     | all methods     | all            |  allow  | allow* |  allow
//
//   * dbExec destructive operations are independently blocked by the SQL
//     blocklist on the server (DROP / TRUNCATE / DELETE without WHERE etc).
//     The role gate sits in front of that — viewers can't reach the SQL
//     surface at all; editors and above hit the SQL gate as well.
//
// The SQL helpers are denied entirely for viewers (not just dbExec) because
// the dbQuery surface in dev mode bypasses the production scoping shim and
// can leak other users' rows in template tables that aren't in
// SENSITIVE_SQL_RE.

export type ExtensionBridgeRole = "owner" | "admin" | "editor" | "viewer";

const READ_METHODS = new Set(["GET", "HEAD"]);

export interface BridgePolicyContext {
  /** Extension id currently owning the iframe. Used for narrow helper-specific exceptions. */
  extensionId?: string;
  /** Resolved role of the viewer on this extension. */
  role: ExtensionBridgeRole;
  /** True when viewer is the extension's owner_email — equivalent to role "owner"
   *  but cheaper to plumb through from the render binding. */
  isAuthor: boolean;
  /** Database-backed extensions use role gates; local-file extensions use manifest gates. */
  source?: "database" | "local-files";
  permissions?: {
    appActions?: string[];
    extensionData?: boolean;
    sql?: boolean;
    externalFetch?: boolean;
  };
}

export interface BridgePolicyResult {
  ok: boolean;
  /** Human-readable error to send back to the iframe when ok=false. */
  error?: string;
}

/**
 * Decide whether the iframe is allowed to proxy this request given the
 * viewer's role on the extension. Authors (and owner/admin/editor in general)
 * keep the full bridge surface; viewers get a strictly read-only subset.
 *
 * Called BEFORE the request leaves the parent — so a denial is local-only
 * and never reveals server state to the iframe.
 */
export function checkBridgePolicy(
  path: string,
  method: string,
  ctx: BridgePolicyContext,
): BridgePolicyResult {
  if (ctx.source === "local-files") {
    return checkLocalFileBridgePolicy(path, method, ctx);
  }

  // Authors and the highest non-owner roles get the unrestricted bridge.
  if (ctx.isAuthor || ctx.role === "owner" || ctx.role === "admin") {
    return { ok: true };
  }

  // Editors get write access EXCEPT for the helper-specific destructive
  // operations the server still gates (the SQL blocklist + per-action
  // toolCallable flag, see audit H5).
  if (ctx.role === "editor") {
    return { ok: true };
  }

  // From here on: role === "viewer". Lock down everything beyond reads.
  const upperMethod = method.toUpperCase();

  // SQL is denied for viewers entirely (defense-in-depth: dev mode bypasses
  // the production scoping shim).
  if (path === "/_agent-native/extensions/sql/query") {
    return {
      ok: false,
      error: deniedMessage("dbQuery", ctx.role),
    };
  }
  if (path === "/_agent-native/extensions/sql/exec") {
    return {
      ok: false,
      error: deniedMessage("dbExec", ctx.role),
    };
  }

  // Actions are allowed for viewers; action-routes enforces each action's
  // `toolCallable` opt-out server-side. This keeps read-oriented widgets like
  // inbox stats usable when shared while still blocking sensitive actions such
  // as share/unshare through their per-action flags.
  if (path.startsWith("/_agent-native/actions/")) {
    return { ok: true };
  }

  // Extension-data writes/deletes are denied; reads (GET/HEAD) are allowed.
  // Match /_agent-native/extensions/data/<extensionId>/<collection>[/<itemId>].
  if (path.startsWith("/_agent-native/extensions/data/")) {
    if (READ_METHODS.has(upperMethod)) return { ok: true };
    return {
      ok: false,
      error: deniedMessage("extensionData.set/remove", ctx.role),
    };
  }

  // extensionFetch — outbound proxy. POSTed JSON body carries the upstream method.
  // The bridge can only see the path here, not the upstream method, so we
  // restrict by REQUEST method (POST to /proxy carries the actual upstream
  // method as { method: 'GET' | ... } in body). For viewers we pre-flight-
  // deny the proxy unless a future code path emits a GET to /proxy/preview.
  // In practice, extensionFetch always POSTs to /proxy, so a viewer's extensionFetch
  // is denied entirely. Adapt this if /proxy gains a GET preview surface.
  if (path === "/_agent-native/extensions/proxy") {
    return {
      ok: false,
      error: deniedMessage("extensionFetch", ctx.role),
    };
  }

  // application-state — viewers can read but not write.
  if (path.startsWith("/_agent-native/application-state/")) {
    if (READ_METHODS.has(upperMethod)) return { ok: true };
    if (
      upperMethod === "PUT" &&
      isInlineUiOutputApplicationStatePath(path, ctx.extensionId)
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      error: deniedMessage("appFetch (mutation)", ctx.role),
    };
  }

  // Generic appFetch — reads only for viewers.
  if (READ_METHODS.has(upperMethod)) return { ok: true };
  return {
    ok: false,
    error: deniedMessage("appFetch", ctx.role),
  };
}

function deniedMessage(helper: string, role: ExtensionBridgeRole): string {
  return `Helper '${helper}' is not allowed for role '${role}' on this extension`;
}

function localDeniedMessage(helper: string): string {
  return `Helper '${helper}' is not allowed by this local extension's extension.json permissions`;
}

function actionNameFromPath(path: string): string | null {
  try {
    const pathname = new URL(path, "http://agent-native.local").pathname;
    const prefix = "/_agent-native/actions/";
    if (!pathname.startsWith(prefix)) return null;
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

function localAllowsAction(ctx: BridgePolicyContext, path: string): boolean {
  const action = actionNameFromPath(path);
  if (!action) return false;
  const actions = ctx.permissions?.appActions ?? [];
  return actions.includes("*") || actions.includes(action);
}

function checkLocalFileBridgePolicy(
  path: string,
  method: string,
  ctx: BridgePolicyContext,
): BridgePolicyResult {
  const upperMethod = method.toUpperCase();

  if (path.startsWith("/_agent-native/actions/")) {
    if (localAllowsAction(ctx, path)) return { ok: true };
    return { ok: false, error: localDeniedMessage("appAction") };
  }

  if (
    path === "/_agent-native/extensions/sql/query" ||
    path === "/_agent-native/extensions/sql/exec"
  ) {
    return { ok: false, error: localDeniedMessage("dbQuery/dbExec") };
  }

  if (path === "/_agent-native/extensions/proxy") {
    return { ok: false, error: localDeniedMessage("extensionFetch") };
  }

  if (path.startsWith("/_agent-native/extensions/data/")) {
    if (ctx.permissions?.extensionData === false) {
      return { ok: false, error: localDeniedMessage("extensionData") };
    }
    return { ok: true };
  }

  if (path.startsWith("/_agent-native/application-state/")) {
    if (READ_METHODS.has(upperMethod)) return { ok: true };
    if (
      upperMethod === "PUT" &&
      isInlineUiOutputApplicationStatePath(path, ctx.extensionId)
    ) {
      return { ok: true };
    }
    return { ok: false, error: localDeniedMessage("applicationState") };
  }

  if (READ_METHODS.has(upperMethod)) return { ok: true };
  return { ok: false, error: localDeniedMessage("appFetch") };
}

function isInlineUiOutputApplicationStatePath(
  path: string,
  extensionId?: string,
): boolean {
  if (!extensionId) return false;
  try {
    const pathname = new URL(path, "http://agent-native.local").pathname;
    const prefix = "/_agent-native/application-state/";
    if (!pathname.startsWith(prefix)) return false;
    const key = decodeURIComponent(pathname.slice(prefix.length));
    return key === `inline-ui:${extensionId}:output`;
  } catch {
    return false;
  }
}
