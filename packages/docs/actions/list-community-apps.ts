import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { loadCommunityAppCatalog } from "../server/lib/community-apps.server";

export default defineAction({
  description: "List published community apps for the public catalog.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: false,
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async () => loadCommunityAppCatalog(),
});
