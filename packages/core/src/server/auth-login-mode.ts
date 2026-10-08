import { getDeploymentEmailReadiness, type EmailReadiness } from "./email.js";

export type AuthLoginMode = "magic-link" | "password";

export function isEmailReadyForMagicLink(
  emailReadiness: EmailReadiness,
): boolean {
  return emailReadiness.status === "ready";
}

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

export async function getAuthLoginMode(): Promise<AuthLoginMode> {
  return resolveAuthLoginModeFromReadiness(getDeploymentEmailReadiness());
}
