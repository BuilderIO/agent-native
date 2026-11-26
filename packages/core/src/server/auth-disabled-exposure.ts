import { isAuthDisabled } from "../shared/auth-disabled.js";
import { isProductionLikeRuntime } from "./credential-provider.js";
import { isPublicDevContainer } from "./loopback.js";

export type AuthDisabledExposure = "hosted" | "public-dev-container";

/**
 * Where an `AUTH_DISABLED` server can be reached by people other than its
 * developer. `AUTH_DISABLED` signs every request in as one shared user, so it
 * is only safe on a loopback development server.
 */
export function getAuthDisabledExposure(): AuthDisabledExposure | null {
  if (!isAuthDisabled()) return null;
  if (isProductionLikeRuntime()) return "hosted";
  return isPublicDevContainer() ? "public-dev-container" : null;
}

const EXPOSURE_LABELS: Record<AuthDisabledExposure, string> = {
  hosted: "a production or hosted server",
  "public-dev-container": "a dev server published on a public preview URL",
};

export function reportAuthDisabledExposure(
  log: (message: string) => void = console.error,
): void {
  const exposure = getAuthDisabledExposure();
  if (!exposure) return;
  log(
    `[agent-native] AUTH_DISABLED is set on ${EXPOSURE_LABELS[exposure]}. ` +
      "Every visitor is signed in as the same shared user. AUTH_DISABLED is " +
      "for local development on loopback only: unset it and configure " +
      "sign-in (https://agent-native.com/docs/authentication).",
  );
}
