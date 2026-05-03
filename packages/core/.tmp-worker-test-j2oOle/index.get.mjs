
export default (event) =>
  new Response(new URL(event.req.url).pathname, {
    headers: { "content-type": "text/plain" },
  });
