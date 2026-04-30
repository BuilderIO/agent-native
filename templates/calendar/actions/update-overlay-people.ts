import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";
import type { OverlayPerson } from "../shared/api.js";

const overlayPersonSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  color: z.string().min(1),
});

export default defineAction({
  description: "Update overlay people for calendar view",
  schema: z.array(overlayPersonSchema),
  http: { method: "PUT" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    // The frontend sends the array directly as the body
    const people = args as unknown as OverlayPerson[];
    await putUserSetting(email, "calendar-overlay-people", {
      people,
    } as unknown as Record<string, unknown>);
    return people;
  },
});
