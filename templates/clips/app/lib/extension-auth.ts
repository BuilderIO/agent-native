export type ClipsExtensionSession = { email: string; token: string };

const SESSION_RETRY_DELAYS_MS = [250, 750] as const;

export function buildClipsExtensionBaseUrl(
  origin: string,
  appRootPath: string,
): string {
  const url = new URL(appRootPath, origin);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export async function fetchClipsExtensionSession(
  fetchSession: () => Promise<Response>,
  shouldContinue: () => boolean,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ClipsExtensionSession | null> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    if (!shouldContinue()) return null;

    let response: Response | undefined;
    try {
      response = await fetchSession();
    } catch (error) {
      lastError = error;
    }
    if (!shouldContinue()) return null;

    if (response?.ok) {
      const session: unknown = await response.json();
      if (
        !session ||
        typeof session !== "object" ||
        !("email" in session) ||
        typeof session.email !== "string" ||
        !session.email ||
        !("token" in session) ||
        typeof session.token !== "string" ||
        !session.token
      ) {
        throw new Error(
          "The Clips session endpoint returned an invalid session.",
        );
      }
      return { email: session.email, token: session.token };
    }
    if (response && response.status < 500) {
      if (response.status === 401 || response.status === 403) return null;
      throw new Error(
        `The Clips session endpoint failed with HTTP ${response.status}.`,
      );
    }
    if (response) {
      lastError = new Error(
        `The Clips session endpoint failed with HTTP ${response.status}.`,
      );
    }

    if (!shouldContinue()) return null;
    if (attempt >= SESSION_RETRY_DELAYS_MS.length) {
      throw (
        lastError ?? new Error("The Clips session endpoint is unavailable.")
      );
    }
    await pause(SESSION_RETRY_DELAYS_MS[attempt]);
  }
}
