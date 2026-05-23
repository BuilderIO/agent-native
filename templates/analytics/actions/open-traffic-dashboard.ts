import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

const TRAFFIC_DASHBOARD_PATH = "/adhoc/agent-native-templates-first-party";
const TRAFFIC_DASHBOARD_ID = "agent-native-templates-first-party";

function trafficDashboardDeepLink(): string {
  return buildDeepLink({
    app: "analytics",
    view: "adhoc",
    to: TRAFFIC_DASHBOARD_PATH,
    params: { dashboardId: TRAFFIC_DASHBOARD_ID },
  });
}

export default defineAction({
  description:
    "Open the first-party traffic dashboard in the real Analytics app. Use this directly when the user asks to see their traffic dashboard, site traffic, app traffic, or first-party analytics dashboard inline in ChatGPT or Claude. Do not call view-screen, ask_app, or broad resource discovery first for this known dashboard.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Traffic dashboard",
      description:
        "Open the first-party traffic dashboard in the real Analytics app.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open traffic dashboard",
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
    dashboardId: TRAFFIC_DASHBOARD_ID,
    path: TRAFFIC_DASHBOARD_PATH,
    url: trafficDashboardDeepLink(),
    embed: true,
    title: "Traffic dashboard",
    message: "Traffic dashboard is ready.",
  }),
});
