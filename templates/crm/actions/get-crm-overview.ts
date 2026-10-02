import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCrmOverview } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "Return a compact, access-scoped CRM work overview: open follow-up tasks, recently active mirrored records, and pending write proposals.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  // Its record read resolves provider scope without the caller's identity,
  // so it stays off MCP and A2A, full catalog included.
  mcpTool: false,
  run: () => getCrmOverview(),
});
