import { defineAction, embedApp } from "@agent-native/core";
import { z } from "zod";

const TRAFFIC_DASHBOARD_PATH = "/adhoc/agent-native-templates-first-party";
const MCP_APP_FRAME_DOMAINS = [
  "https:",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

export default defineAction({
  description:
    "Open the first-party traffic dashboard in the real Analytics app. Use this directly when the user asks to see their traffic dashboard, site traffic, app traffic, or first-party analytics dashboard inline in ChatGPT or Claude. Do not call view-screen, ask_app, or broad resource discovery first for this known dashboard.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  mcpApp: {
    resource: embedApp({
      title: "Traffic dashboard",
      description:
        "Open the first-party traffic dashboard in the real Analytics app.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open traffic dashboard",
      frameDomains: MCP_APP_FRAME_DOMAINS,
      height: 900,
    }),
  },
  link: ({ result }) => {
    const url =
      result && typeof result === "object"
        ? (result as { url?: unknown }).url
        : null;
    if (typeof url !== "string" || !url) return null;
    return {
      url,
      label: "Open traffic dashboard",
      view: "adhoc",
    };
  },
  run: async () => ({
    app: "analytics",
    view: "adhoc",
    path: TRAFFIC_DASHBOARD_PATH,
    url: TRAFFIC_DASHBOARD_PATH,
    embed: true,
    title: "Traffic dashboard",
    message: "Traffic dashboard is ready.",
  }),
});
