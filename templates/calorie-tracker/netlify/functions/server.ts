import { createRequestHandler } from "react-router";

const handler = createRequestHandler(
  // @ts-ignore - resolved at build time
  () => import("../../build/server/index.js"),
);

export default async (request: Request) => {
  const url = new URL(request.url);

  // Framework routes (/_agent-native/*) are not part of the React Router
  // build — they're handled by the agent-native framework plugins.
  // In production on Netlify, these routes aren't available since there's
  // no running Nitro server. Return appropriate responses:
  if (url.pathname.startsWith("/_agent-native/poll")) {
    // Polling endpoint — return empty events (no live server to poll)
    return new Response(JSON.stringify({ version: 0, events: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname.startsWith("/_agent-native/ping")) {
    return new Response(JSON.stringify({ message: "pong" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname.startsWith("/_agent-native/")) {
    // Other framework routes — return 501 (not implemented in serverless)
    return new Response(
      JSON.stringify({ error: "Not available in serverless mode" }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }

  // All other routes go through React Router SSR
  return handler(request);
};
