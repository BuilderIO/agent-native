import { defineAction } from "@agent-native/core";

import {
  listSourceCursors,
  listSourceCursorsInputSchema,
} from "../server/lib/sync.js";

export default defineAction({
  description:
    "List delivery provider sync cursors visible to the current user.",
  schema: listSourceCursorsInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listSourceCursors,
});
