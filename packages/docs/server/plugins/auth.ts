import {
  createAuthPlugin,
  getAppBasePath,
  type AuthOptions,
} from "@agent-native/core/server";
import { getCookie, getRequestURL, setCookie, type H3Event } from "h3";
import { randomUUID } from "crypto";

export function shouldCreateDocsSessionForPath(
  pathname: string,
  basePath = getAppBasePath(),
): boolean {
  const pathWithoutBase =
    basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  return (
    pathWithoutBase.startsWith("/_agent-native/") ||
    pathWithoutBase.startsWith("/api/")
  );
}

function shouldCreateDocsSession(event: H3Event): boolean {
  const pathname = getRequestURL(event).pathname;
  return shouldCreateDocsSessionForPath(pathname);
}

export const docsAuthOptions: AuthOptions = {
  workspaceAppAudience: "public",
  getSession: async (event) => {
    const cookieName = "an_docs_session";
    let sessionId = getCookie(event, cookieName);

    if (!sessionId) {
      if (!shouldCreateDocsSession(event)) return null;

      sessionId = randomUUID();
      setCookie(event, cookieName, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }

    return {
      email: `anon-${sessionId}@agent-native.com`,
      userId: sessionId,
    };
  },
};

export default createAuthPlugin(docsAuthOptions);
