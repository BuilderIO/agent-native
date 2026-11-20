import { defineActionErrors } from "@agent-native/core/action";
import { count } from "drizzle-orm";

import type { Filter } from "../shared/types.js";
import { getDb, schema } from "./db/index.js";
import { seedWorkspace } from "./seed.js";

export const errors = defineActionErrors("not_found", "conflict", "invalid_input");

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
export const nowIso = () => new Date().toISOString();

let seeding: Promise<void> | null = null;

// Demo data is created lazily behind the first request, never at cold start.
export function ready(): Promise<void> {
  seeding ??= (async () => {
    const [row] = await getDb().select({ n: count() }).from(schema.journeys);
    if (!row || row.n === 0) await seedWorkspace();
  })().catch((error) => {
    seeding = null;
    throw error;
  });
  return seeding;
}

import { matchesFilter, type AccountRow, type ContactRow } from "./filter.js";
export type { AccountRow, ContactRow };

export async function loadPeople() {
  const db = getDb();
  const [contacts, accounts, audiences] = await Promise.all([
    db.select().from(schema.contacts),
    db.select().from(schema.accounts),
    db.select().from(schema.audiences),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const audienceMembers = new Map<string, Set<string>>();
  for (const a of audiences) if (a.kind === "static") audienceMembers.set(a.id, new Set(a.memberIds as string[]));
  return { contacts, accounts, accountById, audiences, audienceMembers };
}

export async function evaluateAudience(filter: Filter, kind: string, memberIds: string[]) {
  const { contacts, accountById, audienceMembers } = await loadPeople();
  const matched =
    kind === "static"
      ? contacts.filter((c) => memberIds.includes(c.id))
      : contacts.filter((c) => matchesFilter(c, accountById.get(c.accountId ?? ""), filter, audienceMembers));
  return { matched, accountById };
}

export function toJson<T extends Record<string, unknown>>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

export function defined<T extends Record<string, unknown>>(values: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as never;
}
