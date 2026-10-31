import { redirectDocument } from "react-router";

import {
  SIGN_IN_ENTRY_PATH,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { apiBaseUrl, appBasePath, appPath } from "./api-path.js";
import { serverSignInHref } from "./sign-in-return.js";

/**
 * Templates export this directly as a route loader, so React Router passes
 * its loader arguments where a caller would pass `homePath`.
 */
export function signInLandingLoader(
  homePathOrArgs?: string | { request?: Request },
  request?: Request,
) {
  const homePath =
    typeof homePathOrArgs === "string" ? homePathOrArgs : undefined;
  if (homePath === "/") return null;
  const base = apiBaseUrl();
  if (!base) return redirectDocument(appPath(SIGN_IN_ENTRY_PATH));

  const uiOrigin =
    (
      request ??
      (typeof homePathOrArgs === "object" ? homePathOrArgs.request : undefined)
    )?.url ??
    (typeof window === "undefined" ? undefined : window.location.href);
  if (!uiOrigin) return redirectDocument(`${base}${SIGN_IN_ENTRY_PATH}`);
  // Resume at the UI's home, never at this route: it would sign in again.
  const uiHomePath =
    homePath ??
    (typeof window === "undefined"
      ? undefined
      : window.__AGENT_NATIVE_CONFIG__?.appHomePath);
  const { resumeHref } = signInJourney({
    at: "",
    basePath: appBasePath(),
    ...(uiHomePath ? { homePath: uiHomePath } : {}),
  });
  return redirectDocument(
    serverSignInHref(base, new URL(resumeHref, uiOrigin).href),
  );
}
