import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  envKeys: [{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" }],
  resolveOpenPath: ({ view, params }) => {
    if (view === "detail" && params.workItemId) {
      return `/work-items/${encodeURIComponent(params.workItemId)}`;
    }
    if (view === "routing-rules") return "/routing-rules";
    return "/queue";
  },
});
