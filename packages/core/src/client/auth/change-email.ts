import { agentNativePath } from "../api-path.js";

/**
 * Starts a verified email change for the signed-in user. The confirmation goes
 * to the current address first; the account keeps its email until the user
 * follows that link. Throws when the auth server does not accept the request.
 */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/auth/ba/change-email"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail }),
    },
  );
  let data: { status?: unknown } | null = null;
  try {
    data = (await response.json()) as { status?: unknown };
  } catch (error) {
    console.warn("[settings] change-email response was not JSON", error);
  }
  if (!response.ok || data?.status !== true) {
    throw new Error("change-email failed");
  }
}
