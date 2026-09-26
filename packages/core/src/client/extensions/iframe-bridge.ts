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

// viewer's session cookie. That means a non-author viewer's session can be

export type ExtensionBridgeRole =
  | "owner"
  | "admin"
  | "editor"
  | "commenter"
  | "viewer";

const READ_METHODS = new Set(["GET", "HEAD"]);

export interface BridgePolicyContext {
  extensionId?: string;
  role: ExtensionBridgeRole;
  isAuthor: boolean;
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
  error?: string;
}

export function checkBridgePolicy(
  path: string,
  method: string,
  ctx: BridgePolicyContext,
): BridgePolicyResult {
  if (ctx.source === "local-files") {
    return checkLocalFileBridgePolicy(path, method, ctx);
  }

  if (ctx.isAuthor || ctx.role === "owner" || ctx.role === "admin") {
    return { ok: true };
  }

  if (ctx.role === "editor") {
    return { ok: true };
  }

  const upperMethod = method.toUpperCase();

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

  if (path.startsWith("/_agent-native/actions/")) {
    return { ok: true };
  }

  if (path.startsWith("/_agent-native/extensions/data/")) {
    if (READ_METHODS.has(upperMethod)) return { ok: true };
    return {
      ok: false,
      error: deniedMessage("extensionData.set/remove", ctx.role),
    };
  }

  if (path === "/_agent-native/extensions/proxy") {
    return {
      ok: false,
      error: deniedMessage("extensionFetch", ctx.role),
    };
  }

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
