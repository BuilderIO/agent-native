function localHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

export function shouldOfferGoogleOAuthSetup(): boolean {
  const env = (import.meta.env ?? {}) as Record<string, unknown>;
  if (env.DEV === true) return true;
  if (env.VITE_ENABLE_GOOGLE_OAUTH_SETUP === "true") return true;
  if (typeof window === "undefined") return false;
  return localHostname(window.location.hostname.toLowerCase());
}
