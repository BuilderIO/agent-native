import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "compositions",
  contentColumn: "data",
  idColumn: "id",
  autoSeed: true,
});
