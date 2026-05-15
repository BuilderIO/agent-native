import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAccessibleCapture, serializeCapture } from "../server/lib/brain.js";

export default defineAction({
  description: "Get one raw Brain capture by ID if its source is accessible.",
  schema: z.object({
    id: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const access = await getAccessibleCapture(id);
    if (!access) return { capture: null };
    return {
      capture: serializeCapture(access.capture),
      source: {
        id: access.source.id,
        title: access.source.title,
        provider: access.source.provider,
      },
      accessRole: access.role,
    };
  },
});
