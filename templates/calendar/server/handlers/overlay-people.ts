import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import type { OverlayPerson } from "../../shared/api.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { readBody, getSession } from "@agent-native/core/server";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

export const getOverlayPeople = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const data = await getUserSetting(email, "calendar-overlay-people");
    return (data as { people: OverlayPerson[] } | null)?.people ?? [];
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const updateOverlayPeople = defineEventHandler(
  async (event: H3Event) => {
    try {
      const email = await uEmail(event);
      const people: OverlayPerson[] = await readBody(event);
      await putUserSetting(email, "calendar-overlay-people", {
        people,
      } as unknown as Record<string, unknown>);
      return people;
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);
