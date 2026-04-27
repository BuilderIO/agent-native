import { createCollabPlugin } from "@agent-native/core/server";

// Dashboard configs are JSON stored as text in the `config` column.
// The collab plugin seeds Y.Text("content") from the config column so
// real-time sync works at the document level. Individual panel edits
// are serialised as JSON text updates.
// TODO: Switch to contentType: "json" when structured data collab is ready
export default createCollabPlugin({
  table: "dashboards",
  contentColumn: "config",
  idColumn: "id",
  autoSeed: true,
});
