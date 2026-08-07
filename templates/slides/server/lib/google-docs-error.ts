export function formatGoogleOAuthError(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : String(error || "Unknown error");
  const message = rawMessage.replace(/\s+/g, " ").trim();
  const normalized = message.toLowerCase();

  if (
    normalized.includes("insufficient permission") ||
    normalized.includes("insufficient_scope")
  ) {
    return "Google Docs access was denied. Connect again and approve the requested Google Drive file permission.";
  }
  if (
    normalized.includes("redirect_uri_mismatch") ||
    normalized.includes("redirect uri")
  ) {
    return "Google rejected the redirect URI. Add the current Slides callback URL to the Google OAuth client and try again.";
  }
  if (
    normalized.includes("access_denied") ||
    normalized.includes("user denied") ||
    normalized === "denied"
  ) {
    return "Google access was canceled or denied. Connect Google again and approve access.";
  }
  if (
    normalized.includes("invalid_grant") ||
    normalized.includes("connection expired") ||
    normalized.includes("token has been expired")
  ) {
    return "The Google connection expired. Connect Google again.";
  }
  if (
    normalized.includes("invalid_client") ||
    normalized.includes("unauthorized_client")
  ) {
    return "Google rejected the OAuth client configuration. Check the Slides Google OAuth credentials and authorized redirect URI.";
  }
  if (
    normalized.includes("unverified") ||
    normalized.includes("not verified") ||
    normalized.includes("test user") ||
    normalized.includes("sensitive app") ||
    normalized.includes("access blocked")
  ) {
    return "Google blocked this app because its OAuth consent screen is unverified or this account is not an allowed test user.";
  }

  return message.slice(0, 240) || "Google OAuth failed. Try connecting again.";
}
