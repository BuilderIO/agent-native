import { defineEventHandler } from "h3";

export default defineEventHandler(() => {
  return new Response(null, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
});
