import { createCoreRoutesPlugin } from "@agent-native/core/server";

const VIEW_PATHS: Record<string, string> = {
  overview: "/",
  records: "/records",
  record: "/records",
  tasks: "/tasks",
  proposals: "/proposals",
  settings: "/settings",
};

export default createCoreRoutesPlugin({
  resolveOpenPath: ({ view, params }) => {
    if (params.recordId) return `/records/${params.recordId}`;
    return view ? (VIEW_PATHS[view] ?? null) : null;
  },
});
