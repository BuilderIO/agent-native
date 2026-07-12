export const AGENT_NATIVE_OPEN_PATH = "/_agent-native/open";
export const AGENT_SIDEBAR_QUERY_PARAM = "agentSidebar";
export const AGENT_SIDEBAR_QUERY_VALUE_CLOSED = "closed";

const RELATIVE_URL_BASE = "http://agent-native.invalid";

function hasUrlScheme(urlOrPath: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(urlOrPath);
}

export function isAgentNativeOpenDeepLink(urlOrPath: string): boolean {
  try {
    const absolute = hasUrlScheme(urlOrPath);
    const url = absolute
      ? new URL(urlOrPath)
      : new URL(urlOrPath, RELATIVE_URL_BASE);
    if (url.protocol === "agentnative:" && url.host === "open") return true;
    return url.pathname === AGENT_NATIVE_OPEN_PATH;
  } catch {
    return false;
  }
}

export function withCollapsedAgentSidebarParam(urlOrPath: string): string {
  try {
    const absolute = hasUrlScheme(urlOrPath);
    const url = absolute
      ? new URL(urlOrPath)
      : new URL(urlOrPath, RELATIVE_URL_BASE);
    url.searchParams.set(
      AGENT_SIDEBAR_QUERY_PARAM,
      AGENT_SIDEBAR_QUERY_VALUE_CLOSED,
    );
    if (absolute) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return urlOrPath;
  }
}
