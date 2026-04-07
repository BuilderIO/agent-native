import { defineEventHandler } from "h3";

let handler: ((req: Request) => Promise<Response>) | null = null;

async function getHandler() {
  if (handler) return handler;
  const { createRequestHandler } = await import("react-router");
  handler = createRequestHandler(
    () => import("virtual:react-router/server-build"),
  );
  return handler;
}

export default defineEventHandler(async (event) => {
  const req: Request = (event as any).web?.request ?? (event as any)._request;
  if (!req) {
    const { toWebRequest } = await import("h3");
    const webReq = toWebRequest(event);
    const h = await getHandler();
    return h(webReq);
  }
  const url = new URL(req.url);
  if (url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }
  try {
    const h = await getHandler();
    return await h(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SSR] Error rendering", url.pathname, msg);
    return new Response(
      JSON.stringify({ error: "SSR render failed", message: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
