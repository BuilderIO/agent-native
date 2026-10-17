import {
  SIGN_IN_ENTRY_PATH,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { appBasePath, appPath } from "./api-path.js";

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

export function resolveSignInReturnHref(opts?: {
  returnTo?: string;
}): string | null {
  if (typeof window === "undefined") return null;
  return currentJourney(opts?.returnTo).signInHref;
}

export function buildSignInReturnHref(opts?: { returnTo?: string }): string {
  return resolveSignInReturnHref(opts) ?? appPath(SIGN_IN_ENTRY_PATH);
}
