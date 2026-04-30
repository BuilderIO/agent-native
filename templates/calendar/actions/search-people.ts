import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";

function getDomain(email: string): string | null {
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  const generic = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "me.com",
    "mail.com",
    "localhost",
  ]);
  return generic.has(domain) ? null : domain;
}

interface PersonResult {
  name: string;
  email: string;
  photoUrl?: string;
}

function extractPeople(people: any[]): PersonResult[] {
  return people
    .map((person: any) => {
      const name = person.names?.[0]?.displayName || "";
      const email = person.emailAddresses?.[0]?.value || "";
      const photoUrl = person.photos?.[0]?.url || undefined;
      return { name, email, photoUrl };
    })
    .filter((r) => r.email);
}

export default defineAction({
  description: "Search people in the Google Workspace directory",
  schema: z.object({
    q: z.string().optional().describe("Search query (name or email)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const q = (args.q || "").trim();

    const clients = await googleCalendar.getClients(email);
    if (clients.length === 0) return { results: [] };

    const { accessToken } = clients[0];

    const orgDomains = new Set<string>();
    for (const client of clients) {
      const d = getDomain(client.email);
      if (d) orgDomains.add(d);
    }
    const sessionDomain = getDomain(email);
    if (sessionDomain) orgDomains.add(sessionDomain);

    const isOrgEmail = (e: string) => {
      const d = e.split("@")[1]?.toLowerCase();
      return d ? orgDomains.has(d) : false;
    };

    // Strategy 1: Try Google Workspace directory search
    if (q) {
      try {
        const { peopleSearchDirectoryPeople } =
          await import("../server/lib/google-api.js");
        const data = await peopleSearchDirectoryPeople(accessToken, q);
        if (data.people?.length > 0) {
          const results = extractPeople(data.people);
          return {
            results:
              orgDomains.size > 0
                ? results.filter((p) => isOrgEmail(p.email))
                : results,
          };
        }
      } catch {
        // Fall through to contacts
      }
    }

    // Strategy 2: Search contacts + other contacts, filter to teammates
    try {
      const { peopleListConnections, peopleListOtherContacts } =
        await import("../server/lib/google-api.js");

      const [connections, otherContacts] = await Promise.all([
        peopleListConnections(accessToken, {
          pageSize: 200,
          personFields: "names,emailAddresses,photos",
        }).catch(() => ({ connections: [] })),
        peopleListOtherContacts(accessToken, {
          pageSize: 200,
          readMask: "names,emailAddresses,photos",
        }).catch(() => ({ otherContacts: [] })),
      ]);

      const allPeople = extractPeople([
        ...(connections.connections || []),
        ...(otherContacts.otherContacts || []),
      ]);

      const seen = new Set<string>();
      const clientEmails = new Set(clients.map((c) => c.email.toLowerCase()));
      const deduped = allPeople.filter((p) => {
        const key = p.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        if (key === email.toLowerCase() || clientEmails.has(key)) return false;
        if (orgDomains.size > 0 && !isOrgEmail(key)) return false;
        return true;
      });

      let results: PersonResult[];

      if (q) {
        const lq = q.toLowerCase();
        results = deduped.filter(
          (p) =>
            p.name.toLowerCase().includes(lq) ||
            p.email.toLowerCase().includes(lq),
        );
      } else {
        results = deduped;
      }

      results.sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email),
      );

      return { results: results.slice(0, 30) };
    } catch (error: any) {
      if (error.message?.includes("403")) {
        return { results: [], scopeRequired: true };
      }
      throw error;
    }
  },
});
