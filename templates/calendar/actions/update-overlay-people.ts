import { defineAction } from "@agent-native/core";
import { putUserSetting } from "@agent-native/core/settings";
import type { OverlayPerson } from "../shared/api.js";

export default defineAction({
  description: "Update overlay people for calendar view",
  parameters: {},
  http: { method: "PUT" },
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";
    // The frontend sends the array directly as the body
    const people = args as unknown as OverlayPerson[];
    await putUserSetting(email, "calendar-overlay-people", {
      people,
    } as unknown as Record<string, unknown>);
    return people;
  },
});
