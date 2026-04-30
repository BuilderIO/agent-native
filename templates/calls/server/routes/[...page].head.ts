import { defineEventHandler, getRequestURL } from "h3";

export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event);

  if (pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: { location: "/library" },
    });
  }

  return new Response(null, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
});
