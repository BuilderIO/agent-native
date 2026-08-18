import { getEmailReadiness, type EmailReadiness } from "./email.js";

export type AuthLoginMode = "magic-link" | "password";

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
  return resolveAuthLoginMode(emailReadiness.status === "ready");
}

/** Resolve the browser mode from the same scoped email transport used to send. */
export async function getAuthLoginMode(): Promise<AuthLoginMode> {
  return resolveAuthLoginModeFromReadiness(await getEmailReadiness());
}
