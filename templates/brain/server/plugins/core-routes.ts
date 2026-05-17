import { createCoreRoutesPlugin } from "@agent-native/core/server";

// Map a deep-link `view` to the real Brain SPA path so
// `/_agent-native/open?app=brain&view=…` lands on the right surface before the
// polled `navigate` command applies record focus. Captures have no detail
// route — they live in Search — so `view: "capture"` resolves to `/search`.
const VIEW_PATHS: Record<string, string> = {
  ask: "/",
  search: "/search",
  capture: "/search",
  knowledge: "/knowledge",
  review: "/review",
  proposals: "/review",
  sources: "/sources",
  source: "/sources",
  ops: "/ops",
  settings: "/settings",
};

export default createCoreRoutesPlugin({
  envKeys: [],
  resolveOpenPath: ({ view, params }) => {
    if (view && VIEW_PATHS[view]) return VIEW_PATHS[view];
    if (params.captureId) return "/search";
    if (params.knowledgeId) return "/knowledge";
    if (params.sourceId) return "/sources";
    return null;
  },
});
