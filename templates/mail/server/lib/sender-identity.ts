import { googleFetch } from "./google-api.js";

const GMAIL_SEND_AS_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

type GoogleFetch = typeof googleFetch;

export type SenderIdentity = {
  email: string;
  displayName?: string;
  header: string;
};

export function usableDisplayName(
  name: unknown,
  email: string,
): string | undefined {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return undefined;
  if (value.toLowerCase() === email.trim().toLowerCase()) return undefined;
  return value;
}

export function formatSenderHeader(
  email: string,
  displayName?: string,
): string {
  const cleanEmail = email.trim();
  const cleanName = usableDisplayName(displayName, cleanEmail);
  return cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail;
}

export async function resolveGoogleSenderIdentity({
  accessToken,
  email,
  fallbackName,
  cachedName,
  fetcher = googleFetch,
  onResolvedDisplayName,
}: {
  accessToken: string;
  email: string;
  fallbackName?: string;
  cachedName?: string | null;
  fetcher?: GoogleFetch;
  onResolvedDisplayName?: (displayName: string) => void | Promise<void>;
}): Promise<SenderIdentity> {
  const cleanEmail = email.trim();
  let displayName: string | undefined;

  try {
    const sendAs = await fetcher(GMAIL_SEND_AS_URL, accessToken);
    const match = sendAs?.sendAs?.find(
      (entry: any) =>
        entry.sendAsEmail?.toLowerCase() === cleanEmail.toLowerCase(),
    );
    displayName = usableDisplayName(match?.displayName, cleanEmail);
  } catch {
    // Fall back to cached/profile/settings names below.
  }

  displayName ??= usableDisplayName(cachedName, cleanEmail);

  if (!displayName) {
    try {
      const profile = await fetcher(GOOGLE_USERINFO_URL, accessToken);
      displayName = usableDisplayName(profile?.name, cleanEmail);
    } catch {
      // Fall back to settings or bare email below.
    }
  }

  displayName ??= usableDisplayName(fallbackName, cleanEmail);

  if (displayName) {
    await onResolvedDisplayName?.(displayName);
  }

  return {
    email: cleanEmail,
    displayName,
    header: formatSenderHeader(cleanEmail, displayName),
  };
}
