import {
  peopleListConnections,
  peopleListOtherContacts,
  peopleSearchDirectoryPeople,
} from "./google-api.js";
import * as googleCalendar from "./google-calendar.js";

export type PeopleSearchScope = "all" | "directory";
export type PeopleResultSource = "contact" | "otherContact" | "directory";

export interface PersonResult {
  name: string;
  email: string;
  photoUrl?: string;
  source: PeopleResultSource;
}

interface SearchPeopleOptions {
  q?: string;
  scope?: PeopleSearchScope;
  limit?: number;
}

interface SearchPeopleResponse {
  results: PersonResult[];
  scopeRequired?: boolean;
  directoryLimited?: boolean;
  contactsLimited?: boolean;
}

interface ContactCacheEntry {
  people: PersonResult[];
  contactsLimited: boolean;
  expiresAt: number;
}

const CONTACT_CACHE_TTL = 10 * 60 * 1000;
const contactCache = new Map<string, ContactCacheEntry>();

const GENERIC_EMAIL_DOMAINS = new Set([
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

function getDomain(email: string): string | null {
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  return GENERIC_EMAIL_DOMAINS.has(domain) ? null : domain;
}

function bestPhotoUrl(person: any): string | undefined {
  return (
    person.photos?.find((photo: any) => photo && !photo.default)?.url ||
    person.photos?.[0]?.url ||
    undefined
  );
}

function extractPeople(people: any[], source: PeopleResultSource) {
  return people.flatMap((person: any) => {
    const emails = person.emailAddresses ?? [];
    const name =
      person.names?.find((n: any) => n?.displayName)?.displayName ||
      emails[0]?.value ||
      "";
    const photoUrl = bestPhotoUrl(person);
    return emails
      .map((email: any) => ({
        name: name || email.value || "",
        email: email.value || "",
        photoUrl,
        source,
      }))
      .filter((result: PersonResult) => result.email);
  });
}

function permissionLimited(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("(403)") ||
    message.includes("insufficient") ||
    message.includes("Request had insufficient authentication scopes")
  );
}

function matchesQuery(person: PersonResult, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    person.name.toLowerCase().includes(q) ||
    person.email.toLowerCase().includes(q)
  );
}

function sourceRank(source: PeopleResultSource) {
  switch (source) {
    case "contact":
      return 0;
    case "directory":
      return 1;
    case "otherContact":
      return 2;
  }
}

function cacheKeyForClients(
  currentEmail: string,
  clients: Array<{ email: string }>,
) {
  const accounts = clients
    .map((client) => client.email.toLowerCase())
    .sort()
    .join(",");
  return `${currentEmail.toLowerCase()}:${accounts}`;
}

function mergeCachedContact(
  people: Map<string, PersonResult>,
  person: PersonResult,
) {
  const email = person.email.trim();
  const key = email.toLowerCase();
  if (!key || !key.includes("@")) return;

  const existing = people.get(key);
  if (!existing) {
    people.set(key, { ...person, email });
    return;
  }

  if (sourceRank(person.source) < sourceRank(existing.source)) {
    existing.source = person.source;
  }
  if (
    person.name &&
    person.name !== person.email &&
    (!existing.name || existing.name === existing.email)
  ) {
    existing.name = person.name;
  }
  if (!existing.photoUrl && person.photoUrl) {
    existing.photoUrl = person.photoUrl;
  }
}

function matchRank(person: PersonResult, query: string) {
  if (!query) return sourceRank(person.source);
  const q = query.toLowerCase();
  const name = person.name.toLowerCase();
  const email = person.email.toLowerCase();
  if (email === q || name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (email.startsWith(q)) return 2;
  if (name.includes(q)) return 3;
  if (email.includes(q)) return 4;
  return 5;
}

function mergePerson(
  people: Map<string, PersonResult>,
  person: PersonResult,
  options: {
    query: string;
    orgDomains: Set<string>;
    clientEmails: Set<string>;
    currentEmail: string;
    directoryOnly: boolean;
  },
) {
  const email = person.email.trim();
  const key = email.toLowerCase();
  if (!key || !key.includes("@")) return;
  if (key === options.currentEmail.toLowerCase()) return;
  if (options.clientEmails.has(key)) return;
  if (!matchesQuery(person, options.query)) return;

  if (options.directoryOnly || person.source === "directory") {
    const domain = key.split("@")[1]?.toLowerCase();
    if (options.orgDomains.size > 0 && !options.orgDomains.has(domain)) return;
  }

  const existing = people.get(key);
  if (!existing) {
    people.set(key, { ...person, email });
    return;
  }

  if (sourceRank(person.source) < sourceRank(existing.source)) {
    existing.source = person.source;
  }
  if (
    person.name &&
    person.name !== person.email &&
    (!existing.name || existing.name === existing.email)
  ) {
    existing.name = person.name;
  }
  if (!existing.photoUrl && person.photoUrl) {
    existing.photoUrl = person.photoUrl;
  }
}

async function listConnectionPages(
  accessToken: string,
  kind: "connections" | "otherContacts",
) {
  const people: any[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page++) {
    if (kind === "connections") {
      const response = await peopleListConnections(accessToken, {
        pageSize: 200,
        personFields: "names,emailAddresses,photos",
        pageToken,
      });
      people.push(...(response.connections ?? []));
      pageToken = response.nextPageToken ?? undefined;
    } else {
      const response = await peopleListOtherContacts(accessToken, {
        pageSize: 200,
        readMask: "names,emailAddresses,photos",
        pageToken,
      });
      people.push(...(response.otherContacts ?? []));
      pageToken = response.nextPageToken ?? undefined;
    }

    if (!pageToken) break;
  }

  return people;
}

async function loadCachedContactPeople(
  currentEmail: string,
  clients: Array<{ email: string; accessToken: string }>,
) {
  const cacheKey = cacheKeyForClients(currentEmail, clients);
  const cached = contactCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const people = new Map<string, PersonResult>();
  let contactsLimited = false;

  await Promise.all(
    clients.map(async (client) => {
      try {
        const [connections, otherContacts] = await Promise.all([
          listConnectionPages(client.accessToken, "connections"),
          listConnectionPages(client.accessToken, "otherContacts"),
        ]);

        for (const person of extractPeople(connections, "contact")) {
          mergeCachedContact(people, person);
        }
        for (const person of extractPeople(otherContacts, "otherContact")) {
          mergeCachedContact(people, person);
        }
      } catch (error) {
        if (permissionLimited(error)) contactsLimited = true;
      }
    }),
  );

  const entry: ContactCacheEntry = {
    people: Array.from(people.values()),
    contactsLimited,
    expiresAt: Date.now() + CONTACT_CACHE_TTL,
  };
  contactCache.set(cacheKey, entry);
  return entry;
}

export async function searchPeopleForUser(
  currentEmail: string,
  options: SearchPeopleOptions = {},
): Promise<SearchPeopleResponse> {
  const query = (options.q ?? "").trim();
  const scope = options.scope ?? "all";
  const limit = options.limit ?? 30;

  const clients = await googleCalendar.getClients(currentEmail);
  if (clients.length === 0) return { results: [] };

  const orgDomains = new Set<string>();
  for (const client of clients) {
    const domain = getDomain(client.email);
    if (domain) orgDomains.add(domain);
  }
  const sessionDomain = getDomain(currentEmail);
  if (sessionDomain) orgDomains.add(sessionDomain);

  const clientEmails = new Set(
    clients.map((client) => client.email.toLowerCase()),
  );
  const people = new Map<string, PersonResult>();
  let directoryLimited = false;

  const mergeOptions = {
    query,
    orgDomains,
    clientEmails,
    currentEmail,
    directoryOnly: scope === "directory",
  };

  const cachedContacts = await loadCachedContactPeople(currentEmail, clients);
  for (const person of cachedContacts.people) {
    mergePerson(people, person, mergeOptions);
  }

  if (query) {
    await Promise.all(
      clients.map(async (client) => {
        try {
          const data = await peopleSearchDirectoryPeople(
            client.accessToken,
            query,
            {
              pageSize: 20,
              readMask: "names,emailAddresses,photos",
            },
          );
          for (const person of extractPeople(data.people ?? [], "directory")) {
            mergePerson(people, person, mergeOptions);
          }
        } catch (error) {
          if (permissionLimited(error)) directoryLimited = true;
        }
      }),
    );
  }

  const results = Array.from(people.values())
    .sort((a, b) => {
      const rank = matchRank(a, query) - matchRank(b, query);
      if (rank !== 0) return rank;
      const source = sourceRank(a.source) - sourceRank(b.source);
      if (source !== 0) return source;
      return (a.name || a.email).localeCompare(b.name || b.email);
    })
    .slice(0, limit);

  return {
    results,
    scopeRequired:
      results.length === 0 &&
      (directoryLimited || cachedContacts.contactsLimited)
        ? true
        : undefined,
    directoryLimited: directoryLimited || undefined,
    contactsLimited: cachedContacts.contactsLimited || undefined,
  };
}
