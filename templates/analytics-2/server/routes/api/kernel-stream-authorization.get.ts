import { defineEventHandler, getHeader } from "h3";

import { authorizeKernelStreamConnection } from "../../model/kernel-access.js";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const token = /^Bearer +(\S+)$/i.exec(authorization ?? "")?.[1];
  const status = token ? await authorizeKernelStreamConnection(token) : 403;
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
});
