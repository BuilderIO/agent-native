import { agentNativePath } from "../api-path.js";

/** Requests another verification message for the signed-in user's email. */
export async function resendVerificationEmail(
  email: string,
  callbackURL?: string,
): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/auth/ba/send-verification-email"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        ...(callbackURL ? { callbackURL } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new Error("verification email request failed");
  }
}
