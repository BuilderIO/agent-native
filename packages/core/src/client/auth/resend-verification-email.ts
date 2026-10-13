import { agentNativePath } from "../api-path.js";

function isSuccessfulResendResponse(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "status" in value &&
    value.status === true
  );
}

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
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("verification email request failed");
  }
  if (!isSuccessfulResendResponse(result)) {
    throw new Error("verification email request failed");
  }
}
