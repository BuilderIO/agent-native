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
