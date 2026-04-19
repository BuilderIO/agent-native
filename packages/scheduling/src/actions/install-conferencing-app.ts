import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

export default defineAction({
  description:
    "Install a conferencing app (zero-OAuth apps like built-in video register immediately; OAuth apps start their flow)",
  schema: z.object({
    kind: z.enum(["builtin_video", "zoom_video", "google_meet", "teams_video"]),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const now = new Date().toISOString();
    const id = nanoid();
    await getDb().insert(schema.schedulingCredentials).values({
      id,
      type: args.kind,
      userEmail: currentUserEmail(),
      appId: args.kind,
      isDefault: false,
      invalid: false,
      createdAt: now,
      updatedAt: now,
    });
    return { credentialId: id };
  },
});
