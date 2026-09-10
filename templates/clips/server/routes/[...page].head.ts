import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";

import { MEDIA_CAPTURE_PERMISSIONS_POLICY } from "../lib/media-permissions.js";

export default defineEventHandler((event) => {
  // Set before any short-circuit so the `/` redirect inherits it too.
  setResponseHeader(
    event,
    "Permissions-Policy",
    MEDIA_CAPTURE_PERMISSIONS_POLICY,
  );

  const { pathname } = getRequestURL(event);

  if (pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: {
        // Keep this redirect on the same public SSR-cache path as the shell.
        // Without a content type the deploy adapter cannot apply the canonical
        // cache policy, so every visit to `/` reaches the origin before the
        // already-cached `/library` shell can load.
        "content-type": "text/html; charset=utf-8",
        location: "/library",
        "Permissions-Policy": MEDIA_CAPTURE_PERMISSIONS_POLICY,
      },
    });
  }

  return new Response(null, {
    status: 200,
    headers: {
      "content-type": "text/html",
      "Permissions-Policy": MEDIA_CAPTURE_PERMISSIONS_POLICY,
    },
  });
});
