import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listStatusPages } from "../server/lib/status-pages";

export default defineAction({
  description:
    "List the current user's public status pages with their slug, title, published state, layout options, and included monitors.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return listStatusPages({ email, orgId });
  },
});
