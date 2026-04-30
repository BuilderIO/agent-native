import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "design_files",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: true,
  resourceType: "design",
});
