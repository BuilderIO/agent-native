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

/**
 * Sign-in on a server that does not serve this UI. The server's journey only
 * resumes at its own paths, so the continuation is its UI-return route, which
 * forwards to `uiReturnUrl`. A continuation too long to carry falls back to
 * the UI origin's root rather than the server's home.
 */
export function serverSignInHref(base: string, uiReturnUrl: string): string {
  const serverBasePath = new URL(base).pathname.replace(/\/+$/, "");
  const uiReturn = `${serverBasePath}${toPublicFrameworkPath(UI_RETURN_PATH, {
    publicPrefix: frameworkRoutePrefix(),
  })}`;
  const continuationFor = (target: string) =>
    encodeContinuation(
      `${uiReturn}?${new URLSearchParams({ [UI_RETURN_TARGET_PARAM]: target })}`,
      serverBasePath,
    );
  const token =
    continuationFor(uiReturnUrl) ||
    continuationFor(new URL(appPath("/") || "/", uiReturnUrl).href);
  return `${base}${SIGN_IN_ENTRY_PATH}${
    token ? `?${SIGN_IN_CONTINUATION_PARAM}=${token}` : ""
  }`;
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
