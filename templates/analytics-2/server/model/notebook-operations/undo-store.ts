import { and, desc, eq, or } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

import {
  revisionSchema,
  type Revision,
} from "../../../shared/notebook-snapshot-contract.js";
import type { NotebookUndoRequest } from "../../../shared/notebook-undo.js";
import { projects } from "../../db/schema.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import {
  inverseRevisions,
  notebookUndoPlanSchema,
  resourceRevisions,
  type NotebookUndoPlan,
} from "./undo-plan.js";

const originColumns = () => ({
  orgId: text("workspace_id").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  principalId: text("principal_id").notNull(),
  versionId: text("version_id").notNull(),
  originId: text("origin_id").notNull(),
});

const entries = pgTable(
  "analytics2_notebook_undo_entries",
  {
    ...originColumns(),
    originalOpId: text("original_op_id").notNull(),
    eventSeq: bigint("event_seq", { mode: "bigint" }).notNull(),
    direction: text("direction")
      .$type<NotebookUndoRequest["direction"]>()
      .notNull(),
    plan: jsonb("plan").$type<NotebookUndoPlan>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.orgId,
        table.projectId,
        table.principalId,
        table.versionId,
        table.originId,
        table.originalOpId,
      ],
    }),
    index("analytics2_notebook_undo_stack_idx").on(
      table.orgId,
      table.projectId,
      table.principalId,
      table.versionId,
      table.originId,
      table.direction,
      table.eventSeq.desc(),
    ),
  ],
);

const revisions = pgTable(
  "analytics2_notebook_undo_revisions",
  {
    ...originColumns(),
    resourceKey: text("resource_key").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    equivalentRevision: bigint("equivalent_revision", {
      mode: "bigint",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.orgId,
        table.projectId,
        table.principalId,
        table.versionId,
        table.originId,
        table.resourceKey,
        table.revision,
      ],
    }),
  ],
);

export function undoOrigin(
  scope: WorkspaceScope,
  projectId: string,
  versionId: string,
  originId: string,
) {
  return {
    orgId: scope.orgId,
    projectId,
    versionId,
    originId,
    principalId: scope.ownerEmail,
  };
}

type UndoOrigin = ReturnType<typeof undoOrigin>;

function originFilter(
  table: typeof entries | typeof revisions,
  origin: UndoOrigin,
) {
  return and(
    eq(table.orgId, origin.orgId),
    eq(table.projectId, origin.projectId),
    eq(table.principalId, origin.principalId),
    eq(table.versionId, origin.versionId),
    eq(table.originId, origin.originId),
  );
}

export async function readUndoEntry(
  tx: Queryable,
  origin: UndoOrigin,
  direction: NotebookUndoRequest["direction"],
) {
  const [entry] = await tx
    .select()
    .from(entries)
    .where(and(originFilter(entries, origin), eq(entries.direction, direction)))
    .orderBy(desc(entries.eventSeq))
    .limit(1);
  return entry && { ...entry, plan: notebookUndoPlanSchema.parse(entry.plan) };
}

export type UndoEntry = NonNullable<Awaited<ReturnType<typeof readUndoEntry>>>;

export async function recordUndoEntry(
  tx: Queryable,
  origin: UndoOrigin,
  opId: string,
  eventSeq: bigint,
  plan: NotebookUndoPlan,
) {
  await tx
    .delete(entries)
    .where(and(originFilter(entries, origin), eq(entries.direction, "redo")));
  await tx.insert(entries).values({
    ...origin,
    originalOpId: opId,
    eventSeq,
    direction: "undo",
    plan,
  });
}

export async function readUndoEquivalences(
  tx: Queryable,
  origin: UndoOrigin,
  inverse: NotebookUndoPlan,
  current: Map<string, Revision>,
) {
  const references = inverseRevisions(inverse).flatMap(
    ({ key, expected, target }) =>
      [...new Set([expected, target, current.get(key)])].flatMap((revision) =>
        revision === undefined
          ? []
          : [
              and(
                eq(revisions.resourceKey, key),
                eq(revisions.revision, BigInt(revision)),
              ),
            ],
      ),
  );
  const aliases =
    references.length === 0
      ? []
      : await tx
          .select()
          .from(revisions)
          .where(and(originFilter(revisions, origin), or(...references)));
  const equivalent = new Map(
    aliases.map(({ resourceKey, revision, equivalentRevision }) => [
      `${resourceKey}/${revision}`,
      revisionSchema.parse(equivalentRevision.toString()),
    ]),
  );
  return (key: string, revision: Revision) =>
    equivalent.get(`${key}/${revision}`) ?? revision;
}

export async function advanceUndoEntry(
  tx: Queryable,
  origin: UndoOrigin,
  entry: UndoEntry,
  eventSeq: bigint,
  nextRevision: Revision,
  plan: NotebookUndoPlan,
  equivalent: Awaited<ReturnType<typeof readUndoEquivalences>>,
) {
  const actual = resourceRevisions(plan.after);
  const aliases = inverseRevisions(entry.plan).flatMap(({ key, target }) =>
    target === undefined || actual.get(key) !== nextRevision
      ? []
      : [
          {
            ...origin,
            resourceKey: key,
            revision: BigInt(nextRevision),
            equivalentRevision: BigInt(equivalent(key, target)),
          },
        ],
  );
  if (aliases.length > 0) await tx.insert(revisions).values(aliases);
  const [written] = await tx
    .update(entries)
    .set({
      eventSeq,
      plan,
      direction: entry.direction === "undo" ? "redo" : "undo",
    })
    .where(
      and(
        originFilter(entries, origin),
        eq(entries.originalOpId, entry.originalOpId),
      ),
    )
    .returning({ originalOpId: entries.originalOpId });
  if (!written)
    throw new Error("The notebook undo entry could not be advanced.");
}
