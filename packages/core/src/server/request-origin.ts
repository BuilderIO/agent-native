import { getRequestHeader, type H3Event } from "h3";

function isLoopbackHost(host: string): boolean {
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/**
 * Reject cross-site POSTs. Cookies are `SameSite=None; Secure` over HTTPS so
 * the browser would otherwise attach the session to a forged form submission
 * from evil.com, causing us to spend provider credits on the user's behalf.
 * Same-origin browsers always send `Origin` on POST; if it's missing we fall
 * back to `Sec-Fetch-Site` so Safari's fetch-spec behavior still works.
 */
export function isSameOriginRequest(event: H3Event): boolean {
  // Fetch metadata is browser-controlled and describes the relationship
  // before a reverse proxy rewrites Host (dev-lazy maps :8080 to :8088).
  // Reject an explicit cross-site signal before consulting forgeable headers.
  const fetchSite = getRequestHeader(event, "sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  const host = getRequestHeader(event, "host");
  const origin = getRequestHeader(event, "origin");
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      const forwardedProto = getRequestHeader(event, "x-forwarded-proto");
      const forwardedProtocol =
        forwardedProto === "https" || forwardedProto === "http"
          ? `${forwardedProto}:`
          : null;
      const matchesScheme = forwardedProtocol
        ? parsed.protocol === forwardedProtocol
        : parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && isLoopbackHost(host));
      if (parsed.host === host && matchesScheme) return true;
      // Tauri desktop dev serves the tray WebView from localhost:1420 while
      // the app server lives on the template dev port. Production Tauri
      // WebViews can also send a tauri://localhost origin. Trust that custom
      // scheme, while limiting the web-scheme desktop origins below to a
      // loopback app server so arbitrary websites still fail the CSRF check.
      if (parsed.protocol === "tauri:" && parsed.hostname === "localhost") {
        return true;
      }
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname === "tauri.localhost" &&
        isLoopbackHost(host)
      ) {
        return true;
      }
      if (
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        parsed.port === "1420" &&
        isLoopbackHost(host)
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  // No Origin and no Sec-Fetch-Site: likely a non-browser client (curl,
  // server-side) — safe to allow, CSRF requires a browser with ambient cookies.
  return true;
}
