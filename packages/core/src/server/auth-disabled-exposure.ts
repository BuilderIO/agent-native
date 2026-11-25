import { resolveDeployEnvironment } from "./deploy-environment.js";
import { isPublicDevContainer } from "./loopback.js";

export type AuthDisabledExposure = "production" | "public-dev-container";

/**
 * Where an `AUTH_DISABLED` server can be reached by people other than its
 * developer. `AUTH_DISABLED` signs every request in as one shared user, so it
 * is only safe on a loopback development server.
 */
export function getAuthDisabledExposure(): AuthDisabledExposure | null {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  if (value !== "1" && value !== "true") return null;
  if (
    process.env.NODE_ENV === "production" ||
    resolveDeployEnvironment() === "production"
  ) {
    return "production";
  }
  return isPublicDevContainer() ? "public-dev-container" : null;
}

const EXPOSURE_LABELS: Record<AuthDisabledExposure, string> = {
  production: "a production server",
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
