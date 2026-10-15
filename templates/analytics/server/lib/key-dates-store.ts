import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import type { KeyDate, KeyDateSet } from "../../shared/key-dates.js";
import { isValidPanelEvent } from "../../shared/panel-events.js";
import { getDb, schema } from "../db/index.js";
import {
  inAnnotationScope,
  lockAnnotationScope,
  requireAnnotationScope,
  type AnnotationScope,
} from "./annotation-scope.js";

export const MAX_KEY_DATE_SETS = 50;
export const MAX_KEY_DATES = 1000;
const MAX_SET_NAME_LENGTH = 80;
const MAX_LABEL_LENGTH = 120;

export type KeyDateScope = AnnotationScope;

const sets = schema.analyticsKeyDateSets;
const dates = schema.analyticsKeyDates;

export const requireKeyDateScope = requireAnnotationScope;
const inScope = inAnnotationScope;

function toKeyDate(row: typeof dates.$inferSelect): KeyDate {
  return {
    id: row.id,
    setId: row.setId,
    date: row.date,
    ...(row.time ? { time: row.time } : {}),
    ...(row.timeZone ? { timeZone: row.timeZone } : {}),
    label: row.label,
    addedBy: row.ownerEmail,
    updatedAt: row.updatedAt,
  };
}

function writeInScope<T>(
  scope: KeyDateScope,
  write: (tx: any) => Promise<T>,
): Promise<T> {
  return (getDb() as any).transaction(async (tx: any) => {
    await lockAnnotationScope(tx, scope);
    return write(tx);
  });
}

export async function listKeyDateSets(
  scope: KeyDateScope,
  db: any = getDb(),
): Promise<KeyDateSet[]> {
  const setRows: (typeof sets.$inferSelect)[] = await db
    .select()
    .from(sets)
    .where(inScope(sets, scope))
    .orderBy(asc(sets.name))
    .limit(MAX_KEY_DATE_SETS);
  if (setRows.length === 0) return [];
  const dateRows: (typeof dates.$inferSelect)[] = await db
    .select()
    .from(dates)
    .where(
      and(
        inScope(dates, scope),
        inArray(
          dates.setId,
          setRows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(dates.date), asc(dates.time))
    .limit(MAX_KEY_DATES);
  return setRows.map((row) => ({
    id: row.id,
    name: row.name,
    createdBy: row.ownerEmail,
    updatedAt: row.updatedAt,
    dates: dateRows.filter((date) => date.setId === row.id).map(toKeyDate),
  }));
}

async function findSet(
  db: any,
  scope: KeyDateScope,
  where: ReturnType<typeof eq>,
) {
  const [row] = await db
    .select()
    .from(sets)
    .where(and(inScope(sets, scope), where))
    .limit(1);
  return row as typeof sets.$inferSelect | undefined;
}

function cleanSetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_SET_NAME_LENGTH) {
    fail(
      `A key-date set needs a name of 1 to ${MAX_SET_NAME_LENGTH} characters.`,
      { errorCode: "invalid_key_date_set", statusCode: 400 },
    );
  }
  return trimmed;
}

const sameName = (name: string) =>
  sql`lower(${sets.name}) = ${name.toLowerCase()}`;

async function createSet(
  tx: any,
  scope: KeyDateScope,
  name: string,
): Promise<typeof sets.$inferSelect> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(sets)
    .where(inScope(sets, scope));
  if (Number(total) >= MAX_KEY_DATE_SETS) {
    fail(`Key dates are limited to ${MAX_KEY_DATE_SETS} sets.`, {
      errorCode: "key_date_set_limit",
      statusCode: 409,
    });
  }
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    orgId: scope.orgId,
    ownerEmail: scope.email,
    name,
    createdAt: now,
    updatedAt: now,
  };
  await tx.insert(sets).values(row);
  return row;
}

export async function saveKeyDateSet(
  scope: KeyDateScope,
  input: { id?: string; name: string },
): Promise<KeyDateSet> {
  const name = cleanSetName(input.name);
  return writeInScope(scope, async (tx) => {
    const duplicate = await findSet(
      tx,
      scope,
      input.id ? and(sameName(name), ne(sets.id, input.id))! : sameName(name),
    );
    if (duplicate) {
      fail(`A key-date set named "${duplicate.name}" already exists.`, {
        errorCode: "duplicate_key_date_set",
        statusCode: 409,
      });
    }
    if (!input.id) {
      const created = await createSet(tx, scope, name);
      return {
        id: created.id,
        name: created.name,
        createdBy: created.ownerEmail,
        updatedAt: created.updatedAt,
        dates: [],
      };
    }
    const updated = await tx
      .update(sets)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(and(inScope(sets, scope), eq(sets.id, input.id)))
      .returning({ id: sets.id });
    if (updated.length === 0) notFound("set", input.id);
    const saved = (await listKeyDateSets(scope, tx)).find(
      (set) => set.id === input.id,
    );
    if (!saved) notFound("set", input.id);
    return saved;
  });
}

export async function deleteKeyDateSet(
  scope: KeyDateScope,
  id: string,
): Promise<{ id: string; deletedDates: number }> {
  return writeInScope(scope, async (tx) => {
    if (!(await findSet(tx, scope, eq(sets.id, id)))) notFound("set", id);
    const removedDates = await tx
      .delete(dates)
      .where(and(inScope(dates, scope), eq(dates.setId, id)))
      .returning({ id: dates.id });
    await tx.delete(sets).where(and(inScope(sets, scope), eq(sets.id, id)));
    return { id, deletedDates: removedDates.length };
  });
}

export type SaveKeyDateInput = {
  id?: string;
  setId?: string;
  setName?: string;
  date: string;
  time?: string;
  timeZone?: string;
  label: string;
};

async function resolveSet(
  tx: any,
  scope: KeyDateScope,
  input: Pick<SaveKeyDateInput, "id" | "setId" | "setName">,
): Promise<typeof sets.$inferSelect> {
  if (input.setId) {
    const set = await findSet(tx, scope, eq(sets.id, input.setId));
    if (!set) notFound("set", input.setId);
    return set;
  }
  if (input.setName) {
    const name = cleanSetName(input.setName);
    return (
      (await findSet(tx, scope, sameName(name))) ?? createSet(tx, scope, name)
    );
  }
  if (!input.id) {
    fail("Name the set of a new key date with setId or setName.", {
      errorCode: "invalid_key_date",
      statusCode: 400,
    });
  }
  const [current] = await tx
    .select({ set: sets })
    .from(dates)
    .innerJoin(sets, eq(sets.id, dates.setId))
    .where(
      and(inScope(dates, scope), inScope(sets, scope), eq(dates.id, input.id)),
    )
    .limit(1);
  if (!current) notFound("date", input.id);
  return current.set;
}

export async function saveKeyDate(
  scope: KeyDateScope,
  input: SaveKeyDateInput,
): Promise<KeyDate & { setName: string }> {
  const label = input.label.trim();
  const event = {
    date: input.date,
    label,
    ...(input.time ? { time: input.time } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  };
  if (!isValidPanelEvent(event) || label.length > MAX_LABEL_LENGTH) {
    fail(
      `A key date needs date "YYYY-MM-DD", a label of 1 to ${MAX_LABEL_LENGTH} characters, an optional time "HH:MM", and a time zone (IANA, e.g. "America/New_York") only with a time.`,
      { errorCode: "invalid_key_date", statusCode: 400 },
    );
  }
  return writeInScope(scope, async (tx) => {
    const set = await resolveSet(tx, scope, input);
    const now = new Date().toISOString();
    const values = {
      setId: set.id,
      date: event.date,
      time: event.time ?? null,
      timeZone: event.timeZone ?? null,
      label,
      updatedAt: now,
    };
    if (input.id) {
      const [row] = await tx
        .update(dates)
        .set(values)
        .where(and(inScope(dates, scope), eq(dates.id, input.id)))
        .returning();
      if (!row) notFound("date", input.id);
      return { ...toKeyDate(row), setName: set.name };
    }
    const [{ total }] = await tx
      .select({ total: count() })
      .from(dates)
      .where(inScope(dates, scope));
    if (Number(total) >= MAX_KEY_DATES) {
      fail(`Key dates are limited to ${MAX_KEY_DATES}.`, {
        errorCode: "key_date_limit",
        statusCode: 409,
      });
    }
    const [row] = await tx
      .insert(dates)
      .values({
        ...values,
        id: randomUUID(),
        orgId: scope.orgId,
        ownerEmail: scope.email,
        createdAt: now,
      })
      .returning();
    return { ...toKeyDate(row), setName: set.name };
  });
}

export async function deleteKeyDate(
  scope: KeyDateScope,
  id: string,
): Promise<{ id: string }> {
  return writeInScope(scope, async (tx) => {
    const deleted = await tx
      .delete(dates)
      .where(and(inScope(dates, scope), eq(dates.id, id)))
      .returning({ id: dates.id });
    if (deleted.length === 0) notFound("date", id);
    return { id };
  });
}

function notFound(kind: "set" | "date", id: string): never {
  return fail(
    kind === "set"
      ? `Key-date set ${id} was not found.`
      : `Key date ${id} was not found.`,
    { errorCode: "not_found", statusCode: 404 },
  );
}
