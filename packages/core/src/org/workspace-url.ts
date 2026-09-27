export type ParsedWorkspaceUrl =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function parseWorkspaceUrl(raw: string): ParsedWorkspaceUrl {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Workspace URL is empty" };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch (error) {
    void error;
    return { ok: false, reason: "Not a valid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Workspace URL must be http or https" };
  }
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return { ok: false, reason: "Workspace URL must include a full hostname" };
  }

  return { ok: true, url: parsed.origin };
}

export function isLocalDevelopmentOrigin(currentUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(currentUrl).hostname.toLowerCase();
  } catch (error) {
    void error;
    return false;
  }

  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function shouldOfferWorkspace(
  currentUrl: string,
  workspaceUrl: string | null | undefined,
): boolean {
  if (!workspaceUrl) return false;

  const parsed = parseWorkspaceUrl(workspaceUrl);
  if (!parsed.ok) return false;

  let currentOrigin: string;
  try {
    currentOrigin = new URL(currentUrl).origin;
  } catch (error) {
    void error;
    return false;
  }

  return currentOrigin !== parsed.url;
}
