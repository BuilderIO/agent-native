import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server/request-context";

/**
 * Anonymous visual-edit mutations must start from the Design page transport.
 * The marker alone is forgeable, so require the browser's same-origin metadata
 * too; CLI/MCP callers use the authenticated/local fallback instead.
 */
export function isSameOriginVisualEditBrowserRequest(
  ctx?: Pick<ActionRunContext, "caller" | "requestHeaders">,
): boolean {
  if (ctx?.caller !== "frontend" && ctx?.caller !== "webmcp") return false;
  const headers = ctx.requestHeaders;
  if (!headers) return false;

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = headers.get("origin");
  const requestOrigin = getRequestContext()?.requestOrigin;
  if (!origin || !requestOrigin) return false;
  if (!URL.canParse(origin) || !URL.canParse(requestOrigin)) return false;
  if (new URL(origin).origin !== new URL(requestOrigin).origin) return false;

  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
