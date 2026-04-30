import { getSession } from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { defineEventHandler } from "h3";
import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
);

export default defineEventHandler(async (event) => {
  const p = event.url.pathname;
  if (
    p.startsWith("/.well-known/") ||
    p.startsWith("/_agent-native/") ||
    p.startsWith("/api/") ||
    p === "/favicon.ico" ||
    p === "/favicon.png" ||
    (/\.\w+$/.test(p) && !p.endsWith(".data"))
  ) {
    return new Response(null, { status: 404 });
  }

  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    {
      userEmail: session?.email,
      orgId: session?.orgId,
    },
    async () => handler(event.req as Request),
  );
});
