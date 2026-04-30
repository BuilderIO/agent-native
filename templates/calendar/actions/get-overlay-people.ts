import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";
import type { OverlayPerson } from "../shared/api.js";

export default defineAction({
  description: "Get overlay people for calendar view",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const data = await getUserSetting(email, "calendar-overlay-people");
    return (data as { people: OverlayPerson[] } | null)?.people ?? [];
  },
});
