import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listDbAdminConnections,
  requireDbAdminContextFromRequest,
} from "../server/lib/db-admin-connections";

export default defineAction({
  description:
    "List admin-only connected agent-native app databases available in Analytics DB admin. Requires the caller to be an owner or admin of the active organization.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const admin = await requireDbAdminContextFromRequest(ctx);
    return listDbAdminConnections(admin);
  },
});
