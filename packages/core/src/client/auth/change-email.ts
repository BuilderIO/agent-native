import { agentNativePath } from "../api-path.js";

/** A rejected change-email request; `serverMessage` is the auth server's own
 * sentence when it sent one, and is absent when it did not. */
export class EmailChangeRequestError extends Error {
  readonly serverMessage: string | null;

  constructor(serverMessage: string | null) {
    super(serverMessage ?? "change-email failed");
    this.name = "EmailChangeRequestError";
    this.serverMessage = serverMessage;
  }
}

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
  let data: { status?: unknown; error?: unknown; message?: unknown } | null =
    null;
  try {
    data = (await response.json()) as {
      status?: unknown;
      error?: unknown;
      message?: unknown;
    };
  } catch (error) {
    console.warn("[settings] change-email response was not JSON", error);
  }
  if (!response.ok || data?.status !== true) {
    // The auth server names the cause when it can (for example a deployment
    // with no email provider), so pass that sentence through to the surface
    // instead of a generic failure.
    const said = [data?.error, data?.message].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    throw new EmailChangeRequestError(said ?? null);
  }
}
