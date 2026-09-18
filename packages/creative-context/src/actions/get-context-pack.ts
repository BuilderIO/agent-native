import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getContextPack } from "../store/index.js";

export default defineAction({
  description:
    "Get an accessible context pack with exact immutable item-version evidence.",
  schema: z.object({ packId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ packId }) => ({ pack: await getContextPack(packId) }),
});
