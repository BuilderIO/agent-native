/**
 * Providers verify a webhook Request URL by calling it from their own
 * infrastructure, so a loopback/LAN host or a plain-`http:` origin can never
 * pass verification no matter what the user pastes.
 */
export function isNonPublicWebhookUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return true;
  return isNonPublicHost(url.hostname);
}

function isNonPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true;
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true;
  return (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}
