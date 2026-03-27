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

function getDomain(email: string): string | null {
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  // Skip generic email providers — only match org domains
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

export const searchPeople = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const query = getQuery(event);
    const q = ((query.q as string) || "").trim();

    const clients = await googleCalendar.getClients(email);
    if (clients.length === 0) return { results: [] };

    const { accessToken } = clients[0];
    const orgDomain = getDomain(email);

    // Strategy 1: Try Google Workspace directory search (best results)
    if (q) {
      try {
        const { peopleSearchDirectoryPeople } =
          await import("../lib/google-api.js");
        const data = await peopleSearchDirectoryPeople(accessToken, q);
        if (data.people?.length > 0) {
          return { results: extractPeople(data.people) };
        }
      } catch {
        // 403 or not available — fall through to contacts
      }
    }

    // Strategy 2: Search contacts + other contacts, filter by query and/or org domain
    try {
      const { peopleListConnections, peopleListOtherContacts } =
        await import("../lib/google-api.js");

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

      // Deduplicate by email
      const seen = new Set<string>();
      const deduped = allPeople.filter((p) => {
        const key = p.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        // Exclude the user themselves
        if (key === email.toLowerCase()) return false;
        return true;
      });

      let results: PersonResult[];

      if (q) {
        // Filter by query (name or email match)
        const lq = q.toLowerCase();
        results = deduped.filter(
          (p) =>
            p.name.toLowerCase().includes(lq) ||
            p.email.toLowerCase().includes(lq),
        );
      } else if (orgDomain) {
        // No query — show org-domain contacts as suggestions
        results = deduped.filter((p) =>
          p.email.toLowerCase().endsWith(`@${orgDomain}`),
        );
      } else {
        // No query, no org domain — show recent/frequent contacts
        results = deduped.slice(0, 20);
      }

      // Sort: org-domain contacts first, then alphabetically
      if (orgDomain) {
        results.sort((a, b) => {
          const aOrg = a.email.toLowerCase().endsWith(`@${orgDomain}`) ? 0 : 1;
          const bOrg = b.email.toLowerCase().endsWith(`@${orgDomain}`) ? 0 : 1;
          if (aOrg !== bOrg) return aOrg - bOrg;
          return (a.name || a.email).localeCompare(b.name || b.email);
        });
      }

      return { results: results.slice(0, 30) };
    } catch (error: any) {
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
