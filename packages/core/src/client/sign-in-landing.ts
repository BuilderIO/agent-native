import { redirectDocument } from "react-router";

import { withSsrHtmlContentType } from "../shared/cache-control.js";
import {
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_CONTINUATION_PARAM,
  encodeContinuation,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { normalizeWorkspaceAppHomePath } from "../shared/workspace-app-audience.js";
import {
  apiBaseUrl,
  appBasePath,
  appHomePath,
  appPath,
  isWorkspaceRuntime,
} from "./api-path.js";
import { serverSignInHref } from "./sign-in-return.js";

/**
 * Templates export this directly as a route loader, so React Router passes
 * its loader arguments where a caller would pass `homePath`.
 * `authFirst` opts a shared workspace entry into the sign-in shell before app
 * hydration. Signed-in visitors resume at home through its normal session probe.
 */
export function signInLandingLoader(
  homePathOrArgs?: string | { request?: Request; authFirst?: boolean },
  request?: Request,
) {
  const homePath =
    typeof homePathOrArgs === "string" ? homePathOrArgs : undefined;
  if (homePath === "/") return null;
  const base = apiBaseUrl();
  // A workspace already has one session authority. Let the app's normal
  // session gate resolve it instead of booting a separate sign-in document.
  if (!base && isWorkspaceRuntime()) {
    const workspaceHome = homePath ?? appHomePath();
    if (workspaceHome === "/") return null;
    if (normalizeWorkspaceAppHomePath(workspaceHome) === workspaceHome) {
      const at =
        (
          request ??
          (typeof homePathOrArgs === "object"
            ? homePathOrArgs.request
            : undefined)
        )?.url ??
        (typeof window === "undefined" ? undefined : window.location.href);
      const location = at ? new URL(at) : undefined;
      const target = appPath(
        `${workspaceHome}${location?.search ?? ""}${location?.hash ?? ""}`,
      );
      // Entry routes can show the auth shell before downloading the app shell.
      // Wrap the whole home URL so root c/return query values stay ordinary data.
      const authFirst =
        typeof homePathOrArgs === "object" && homePathOrArgs.authFirst === true;
      // The existing continuation length bound falls back to the plain home.
      const token = authFirst
        ? encodeContinuation(target, appBasePath()) ||
          encodeContinuation(appPath(workspaceHome), appBasePath())
        : "";
      const destination = authFirst
        ? `${appPath(SIGN_IN_ENTRY_PATH)}${
            token ? `?${SIGN_IN_CONTINUATION_PARAM}=${token}` : ""
          }`
        : target;
      return withSsrHtmlContentType(redirectDocument(destination), {
        varyByQuery: true,
      });
    }
  }
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
