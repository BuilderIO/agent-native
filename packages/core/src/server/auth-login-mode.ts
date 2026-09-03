import { getDeploymentEmailReadiness, type EmailReadiness } from "./email.js";

export type AuthLoginMode = "magic-link" | "password";

export function isEmailReadyForMagicLink(
  emailReadiness: EmailReadiness,
): boolean {
  return emailReadiness.status === "ready";
}

/** Magic link is the frictionless default only when outbound email is ready. */
export function resolveAuthLoginMode(emailReady: boolean): AuthLoginMode {
  const optOut = process.env.AUTH_MAGIC_LINK?.trim().toLowerCase();
  if (optOut === "0" || optOut === "false" || optOut === "off") {
    return "password";
  }
  return emailReady ? "magic-link" : "password";
}

export function resolveAuthLoginModeFromReadiness(
  emailReadiness: EmailReadiness,
): AuthLoginMode {
  return resolveAuthLoginMode(isEmailReadyForMagicLink(emailReadiness));
}

/** Resolve browser auth mode from the deployment-wide email transport. */
export async function getAuthLoginMode(): Promise<AuthLoginMode> {
  return resolveAuthLoginModeFromReadiness(getDeploymentEmailReadiness());
}
