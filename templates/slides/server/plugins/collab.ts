import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "decks",
  contentColumn: "data",
  idColumn: "id",
});
