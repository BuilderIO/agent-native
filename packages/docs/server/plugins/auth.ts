import { createAuthPlugin } from "@agent-native/core/server";
import { getCookie, setCookie } from "h3";
import { randomUUID } from "crypto";

export default createAuthPlugin({
  getSession: async (event) => {
    const cookieName = "an_docs_session";
    let sessionId = getCookie(event as any, cookieName);

    if (!sessionId) {
      sessionId = randomUUID();
      setCookie(event as any, cookieName, sessionId, {
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
});
