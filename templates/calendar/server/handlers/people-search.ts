import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import * as googleCalendar from "../lib/google-calendar.js";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

export const searchPeople = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const query = getQuery(event);
    const q = ((query.q as string) || "").trim();

    if (!q) return { results: [] };

    const clients = await googleCalendar.getClients(email);
    if (clients.length === 0) return { results: [] };

    const { accessToken } = clients[0];

    try {
      const { peopleSearchDirectoryPeople } =
        await import("../lib/google-api.js");
      const data = await peopleSearchDirectoryPeople(accessToken, q);
      const results = (data.people || [])
        .map((person: any) => {
          const name = person.names?.[0]?.displayName || "";
          const personEmail = person.emailAddresses?.[0]?.value || "";
          const photoUrl = person.photos?.[0]?.url || undefined;
          return { name, email: personEmail, photoUrl };
        })
        .filter((r: any) => r.email);

      return { results };
    } catch (error: any) {
      // 403 = scope not granted, fall back to empty results
      // The UI supports manual email entry as fallback
      if (error.message?.includes("403")) {
        return { results: [], scopeRequired: true };
      }
      throw error;
    }
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
