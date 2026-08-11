/**
 * Parsing and comparison for `organizations.workspace_url` — the origin of an
 * org's own workspace deployment.
 *
 * The value is set by an owner/admin and then rendered as a link target for
 * every member of the org, so it is parsed at the trust boundary rather than
 * on the way out: anything that is not an `http(s)` origin never reaches the
 * database.
 */

export type ParsedWorkspaceUrl =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Normalize a workspace URL to a bare origin (`https://host[:port]`).
 *
 * Path, query, and hash are dropped: this points at a deployment, not a page,
 * and keeping them would send members to a route that may not exist in the
 * app they arrive at.
 */
export function parseWorkspaceUrl(raw: string): ParsedWorkspaceUrl {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Workspace URL is empty" };
  }

  // Accept a bare host ("agent-workspace.builder.io") the way a browser bar
  // does — otherwise the most natural thing to paste is rejected.
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

/**
 * Whether a URL points at a browser-local development origin.
 *
 * Local development may use a loopback hostname or a subdomain of the
 * reserved `.localhost` domain. Hosted previews must remain eligible for
 * workspace guidance.
 */
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

/**
 * Whether a member currently on `currentUrl` should be pointed at the org's
 * workspace. False when the org has no workspace, when the stored value is
 * unusable, or when they are already on it — including any subdomain-free
 * port/scheme difference, which `URL.origin` compares exactly.
 */
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
