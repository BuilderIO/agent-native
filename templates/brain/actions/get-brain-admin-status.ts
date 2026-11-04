import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { isBrainAdmin } from "../server/lib/zoom-governance.js";

export default defineAction({
  description:
    "Whether the current user is a Brain admin (organization owner or admin). Admins can upload Company Context and manage Zoom sources.",
  schema: z.object({}),
  outputSchema: z.object({ isAdmin: z.boolean() }),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({
    isAdmin: await isBrainAdmin(getRequestUserEmail(), getRequestOrgId()),
  }),
});
