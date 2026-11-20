import { defineMiddleware, getRequestIP } from "h3";

import { runWithClientIp } from "../client-ip.js";

/** Actions cannot see the request, so the address rides an async context that wraps the rest of the chain. */
export default defineMiddleware((event, next) => {
  const header = (name: string) => event.req.headers.get(name)?.trim();
  const ip =
    header("x-nf-client-connection-ip") ||
    header("cf-connecting-ip") ||
    header("x-forwarded-for")?.split(",")[0]?.trim() ||
    getRequestIP(event);
  return runWithClientIp(ip || undefined, next);
});
