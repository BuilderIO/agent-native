import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listDataNotes,
  requireDataNoteScope,
} from "../server/lib/data-notes-store.js";

export default defineAction({
  description:
    "List the organization's data notes, newest first: known tracking problems (kind data) and product incidents (kind incident), each with its date range, status, the event names it applies to, and any charts it is pinned to. A note shows on every chart whose SQL counts one of its matchEvents and none of its unlessEvents, plus its pinned charts, unless a dashboard hides it there. Read-only.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async () => ({ notes: await listDataNotes(requireDataNoteScope()) }),
});
