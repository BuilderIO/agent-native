import { createCoreRoutesPlugin } from "@agent-native/core/server";

const VIEW_PATHS: Record<string, string> = {
  ask: "/home",
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
  googleOAuthManagedConnection: "not_applicable",
  envKeys: [],
  resolveOpenPath: ({ view, params }) => {
    if (view && VIEW_PATHS[view]) return VIEW_PATHS[view];
    if (params.captureId) return "/search";
    if (params.knowledgeId) return "/knowledge";
    if (params.sourceId) return "/sources";
    return null;
  },
});
