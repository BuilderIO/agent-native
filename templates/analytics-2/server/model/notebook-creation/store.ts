import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getDbExec, sql } from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import {
  UNTITLED_PROJECT_NAME,
  type CellDraft,
} from "../../../app/lib/model/contracts.js";
import { creationReceiptSchema } from "../../../shared/notebook-creation.js";
import { getDb, schema } from "../../db/index.js";
import { nowIso } from "../clock.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { projectSnapshot } from "../notebook-operations/store.js";
import {
  assertAuthorizedProject,
  getAuthorizedProjectRow,
} from "../project-access.js";
import { createProject } from "../projects-store.js";
import type { Queryable, WorkspaceScope } from "../scope.js";

const { notebookCreationReceipts: receipts } = schema;
type CreationKey = WorkspaceScope & { requestId: string };

async function readReceipt(key: CreationKey, db: Queryable) {
  const [row] = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.orgId, key.orgId),
        eq(receipts.principalId, key.ownerEmail),
        eq(receipts.requestId, key.requestId),
      ),
    )
    .limit(1);
  return row;
}

async function committedReceipt(
  key: CreationKey,
  row: NonNullable<Awaited<ReturnType<typeof readReceipt>>>,
  db: Queryable,
) {
  const project = await getAuthorizedProjectRow(key, row.projectId, db);
  if (!project || project.trashedAt !== null || row.receipt === null)
    fail("Project not found.", {
      errorCode: "project_not_found",
      statusCode: 404,
    });
  const receipt = creationReceiptSchema.parse(row.receipt);
  if (
    receipt.requestId !== key.requestId ||
    receipt.id !== row.projectId ||
    receipt.projectId !== row.projectId ||
    receipt.workingVersionId !== row.workingVersionId ||
    receipt.snapshot.snapshot.projectId !== row.projectId ||
    receipt.snapshot.snapshot.workspaceId !== key.orgId ||
    receipt.snapshot.snapshot.head.versionId !== row.workingVersionId ||
    receipt.committedAt !== row.committedAt
  )
    throw new Error("Invalid stored notebook creation receipt.");
  return receipt;
}

export async function getProjectCreation(key: CreationKey) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (db) => {
    const row = await readReceipt(key, db);
    if (!row) return { status: "absent" as const };
    return {
      status: "committed" as const,
      receipt: await committedReceipt(key, row, db),
    };
  });
}

async function selectUntitledOrdinal(scope: WorkspaceScope) {
  const pattern = "^" + UNTITLED_PROJECT_NAME + " \\(([1-9][0-9]{0,8})\\)$";
  const { rows } = await getDbExec().execute(sql`
    WITH used AS (
      SELECT untitled_ordinal AS ordinal FROM analytics2_projects
      WHERE org_id = ${sql.value(scope.orgId)} AND owner_email = ${sql.value(scope.ownerEmail)}
        AND trashed_at IS NULL AND archived_at IS NULL AND untitled_ordinal IS NOT NULL
      UNION
      SELECT CASE WHEN title = ${sql.value(UNTITLED_PROJECT_NAME)} THEN 1
                  ELSE substring(title from ${sql.value(pattern)})::int END
      FROM analytics2_projects
      WHERE org_id = ${sql.value(scope.orgId)} AND owner_email = ${sql.value(scope.ownerEmail)}
        AND trashed_at IS NULL AND archived_at IS NULL AND (
          title = ${sql.value(UNTITLED_PROJECT_NAME)} OR title ~ ${sql.value(pattern)}
        )
    ), candidates AS (
      SELECT 1 AS ordinal
      UNION SELECT ordinal + 1 FROM used
    )
    SELECT min(candidates.ordinal) AS ordinal FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM used WHERE used.ordinal = candidates.ordinal)
  `);
  return z.object({ ordinal: z.number().int().positive() }).parse(rows[0])
    .ordinal;
}

export async function createNotebook(
  key: CreationKey,
  input: {
    title?: string;
    description?: string;
    starter: unknown;
    projectId?: string;
    listed?: boolean;
  },
  prepareStarter: () => Promise<{
    cells: CellDraft[];
    recheck: () => Promise<void>;
  }>,
  authorize: () => Promise<void>,
) {
  await ensureAnalyticsDatabase();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const replay = async (
    row: NonNullable<Awaited<ReturnType<typeof readReceipt>>>,
    db: Queryable,
  ) => {
    const receipt = await committedReceipt(key, row, db);
    if (row.fingerprint !== fingerprint)
      fail("This creation request was already used.", {
        errorCode: "creation_intent_reused",
        statusCode: 409,
      });
    return receipt;
  };
  const existing = await readReceipt(key, getDb());
  if (existing) return replay(existing, getDb());
  const { cells, recheck } = await prepareStarter();
  return getDb().transaction(async (db) => {
    await getDbExec().execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(
        ${sql.value(JSON.stringify(["analytics-2:project-create", key.orgId, key.ownerEmail]))},
        0
      ))
    `);
    await authorize();
    const prior = await readReceipt(key, db);
    if (prior) return replay(prior, db);

    const untitledOrdinal = input.title
      ? undefined
      : await selectUntitledOrdinal(key);
    const title =
      input.title ||
      (untitledOrdinal && untitledOrdinal > 1
        ? `${UNTITLED_PROJECT_NAME} (${untitledOrdinal})`
        : UNTITLED_PROJECT_NAME);
    await recheck();
    const committedAt = nowIso();
    const project = await createProject(
      {
        ...key,
        title,
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        ...(input.listed === undefined ? {} : { listed: input.listed }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(untitledOrdinal === undefined ? {} : { untitledOrdinal }),
        cells,
        at: committedAt,
      },
      db,
    );
    const row = await assertAuthorizedProject(key, project.id, db);
    const receipt = creationReceiptSchema.parse({
      requestId: key.requestId,
      projectId: project.id,
      workingVersionId: project.workingVersionId,
      snapshot: await projectSnapshot(key, row, db),
      committedAt,
      href: `/project/${encodeURIComponent(project.id)}/latest`,
      id: project.id,
    });
    await db.insert(receipts).values({
      orgId: key.orgId,
      principalId: key.ownerEmail,
      requestId: key.requestId,
      projectId: receipt.projectId,
      workingVersionId: receipt.workingVersionId,
      fingerprint,
      receipt,
      committedAt,
    });
    await authorize();
    return receipt;
  });
}
