import {
  UI_RETURN_PATH,
  UI_RETURN_TARGET_PARAM,
} from "../shared/api-base-url.js";
import { toPublicFrameworkPath } from "../shared/framework-route-prefix.js";
import {
  encodeContinuation,
  SIGN_IN_CONTINUATION_PARAM,
  SIGN_IN_ENTRY_PATH,
  signInJourney,
} from "../shared/sign-in-journey.js";
import {
  apiBaseUrl,
  appBasePath,
  appPath,
  frameworkRoutePrefix,
} from "./api-path.js";

function currentJourney(returnTo?: string) {
  const { pathname, search, hash } = window.location;
  return signInJourney({
    at: returnTo ?? pathname + search + hash,
    continuation: new URLSearchParams(search).get("c"),
    legacyReturn: new URLSearchParams(search).get("return"),
    basePath: appBasePath(),
    homePath: window.__AGENT_NATIVE_CONFIG__?.appHomePath,
  });
}

function uiReturnRoute(base: string, uiReturnUrl: string): string {
  const serverBasePath = new URL(base).pathname.replace(/\/+$/, "");
  const route = toPublicFrameworkPath(UI_RETURN_PATH, {
    publicPrefix: frameworkRoutePrefix(),
  });
  return `${serverBasePath}${route}?${new URLSearchParams({
    [UI_RETURN_TARGET_PARAM]: uiReturnUrl,
  })}`;
}

/**
 * Sign-in on a server that does not serve this UI. The server's journey only
 * resumes at its own paths, so the continuation is its UI-return route, which
 * forwards to `uiReturnUrl`. A continuation too long to carry falls back to
 * the UI origin's root rather than the server's home.
 */
export function serverSignInHref(base: string, uiReturnUrl: string): string {
  const serverBasePath = new URL(base).pathname.replace(/\/+$/, "");
  const continuationFor = (target: string) =>
    encodeContinuation(uiReturnRoute(base, target), serverBasePath);
  const token =
    continuationFor(uiReturnUrl) ||
    continuationFor(new URL(appPath("/") || "/", uiReturnUrl).href);
  return `${base}${SIGN_IN_ENTRY_PATH}${
    token ? `?${SIGN_IN_CONTINUATION_PARAM}=${token}` : ""
  }`;
}

/**
 * The return target to hand the app's server for an auth step it finishes
 * itself (magic link, email verification, OAuth). The server only resumes at
 * its own paths, so with a separate server this is its UI-return route for
 * `uiPath`; otherwise `sameOriginReturn`, which defaults to `uiPath`.
 */
export function serverAuthReturnPath(
  uiPath: string,
  sameOriginReturn: string = uiPath,
): string {
  const base = apiBaseUrl();
  if (!base || typeof window === "undefined") return sameOriginReturn;
  return uiReturnRoute(base, new URL(uiPath, window.location.origin).href);
}

/**
 * Drop the app's own mount from a path the server will join to that mount.
 *
 * Callers hand over the browser's own location (`window.location.pathname`),
 * which already carries the mount on a path-mounted app (`/calendar-app/week`).
 * `getAppUrl` on the server adds the mount back, so passing the browser path
 * as-is lands on `/calendar-app/calendar-app/week` — a path no route matches,
 * which the calendar catch-all then explains as "Route not found". Stripping
 * here keeps both halves of the contract (see `serverMountReturnPath`) true:
 * the server is always handed a mount-relative path, and a caller that already
 * passed one is unchanged.
 */
function mountRelativePath(path: string): string {
  let base = "";
  try {
    base = appBasePath();
  } catch {
    // No resolvable mount (a non-workspace app): the path is already relative.
    return path;
  }
  if (!base) return path;
  if (path === base) return "/";
  if (path.startsWith(`${base}/`)) return path.slice(base.length);
  const rest = path.slice(base.length);
  if (path.startsWith(base) && (rest.startsWith("?") || rest.startsWith("#"))) {
    return `/${rest}`;
  }
  return path;
}

/**
 * `serverAuthReturnPath` for server flows that resolve their return against
 * the server's own mount (workspace connection OAuth): the UI-return route
 * relative to that mount, in its internal `/_agent-native` form.
 */
export function serverMountReturnPath(
  uiPath: string,
  sameOriginReturn: string = uiPath,
): string {
  if (!apiBaseUrl() || typeof window === "undefined") {
    return mountRelativePath(sameOriginReturn);
  }
  return `${UI_RETURN_PATH}?${new URLSearchParams({
    [UI_RETURN_TARGET_PARAM]: new URL(uiPath, window.location.origin).href,
  })}`;
}

export function resolveSignInReturnHref(opts?: {
  returnTo?: string;
}): string | null {
  if (typeof window === "undefined") return null;
  const journey = currentJourney(opts?.returnTo);
  const base = apiBaseUrl();
  if (!base || journey.signInHref === null) return journey.signInHref;
  return serverSignInHref(
    base,
    new URL(journey.resumeHref, window.location.origin).href,
  );
}

export function buildSignInReturnHref(opts?: { returnTo?: string }): string {
  const base = apiBaseUrl();
  return (
    resolveSignInReturnHref(opts) ??
    (base ? `${base}${SIGN_IN_ENTRY_PATH}` : appPath(SIGN_IN_ENTRY_PATH))
  );
}
