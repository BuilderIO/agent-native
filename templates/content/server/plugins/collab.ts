import { createCollabPlugin } from "@agent-native/core/server";

import { contentLiveCopy } from "../live-copy/binding.js";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: false, // Seeding happens via edit-document action, not on startup
  access: { mode: "resource", resourceType: "document" },
  liveCopy: contentLiveCopy,
});
