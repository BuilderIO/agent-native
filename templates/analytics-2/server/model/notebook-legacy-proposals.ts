import { fail } from "@agent-native/core/action";
import { and, eq, or, sql } from "drizzle-orm";

import { notebookProposalErrors as copy } from "../../app/i18n/messages/notebook-proposal-errors.js";
import { cellContentsSchema } from "../../app/lib/model/contracts.js";
import {
  type LegacyProposalRecovery,
  notebookLegacyProposalRecoverySchema,
  notebookLegacyProposalsSchema,
} from "../../shared/notebook-proposals.js";
import {
  CONTRACT_VERSION,
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { decodeJsonColumn } from "./json-column.js";
import { digest } from "./notebook-execution/planner.js";
import {
  lockNotebookProject,
  notebookUnavailable,
  snapshotRef,
} from "./notebook-operations/store.js";
import { notebookLegacyProposalDispositions as dispositions } from "./notebook-proposal-schema.js";
import { stageNotebookProposal } from "./notebook-proposals.js";
import type { ProjectRow } from "./project-access.js";
import type { Queryable } from "./scope.js";
import {
  requireNotebookThreadBinding,
  type NotebookThreadScope,
} from "./thread-projects.js";

const { cells } = schema;
const pageSize = 200;
const orphanCondition = sql`(${cells.contents}::jsonb -> 'pendingEdit' IS NOT NULL)`;

function workingCells(project: ProjectRow) {
  return and(
    eq(cells.projectId, project.id),
    eq(cells.versionId, project.workingVersionId),
    eq(cells.kind, "sql"),
    orphanCondition,
  );
}

function orphanNotFound(): never {
  return fail(copy.orphanNotFound, {
    statusCode: 404,
    errorCode: "legacy_proposal_not_found",
  });
}

export async function listLegacyNotebookProposals(
  scope: NotebookThreadScope,
  projectId: string,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "share");
    if (project.ownerEmail !== scope.ownerEmail) notebookUnavailable();
    const rows = await tx
      .select({ id: cells.id, contents: cells.contents })
      .from(cells)
      .leftJoin(
        dispositions,
        and(
          eq(dispositions.projectId, cells.projectId),
          eq(dispositions.workingVersionId, cells.versionId),
          eq(dispositions.cellId, cells.id),
          eq(
            dispositions.legacyId,
            sql`${cells.contents}::jsonb -> 'pendingEdit' ->> 'id'`,
          ),
        ),
      )
      .where(and(workingCells(project), sql`${dispositions.legacyId} is null`))
      .orderBy(cells.order)
      .limit(pageSize + 1);
    const changes = rows.slice(0, pageSize).map((row) => {
      const contents = decodeJsonColumn(row.contents, cellContentsSchema);
      if (contents?.kind !== "sql" || !contents.pendingEdit) orphanNotFound();
      const { id, source, baseSource } = contents.pendingEdit;
      return { cellId: row.id, legacyId: id, source, baseSource };
    });
    return notebookLegacyProposalsSchema.parse({
      head: snapshotRef(scope, project).head,
      changes,
      hasMore: rows.length > pageSize,
    });
  });
}

export async function readLegacyDisposition(
  tx: Queryable,
  scope: NotebookThreadScope,
  project: ProjectRow,
  input: LegacyProposalRecovery,
) {
  if (project.ownerEmail !== scope.ownerEmail) notebookUnavailable();
  const [prior] = await tx
    .select()
    .from(dispositions)
    .where(
      and(
        eq(dispositions.projectId, project.id),
        or(
          and(
            eq(dispositions.actorId, scope.ownerEmail),
            eq(dispositions.opId, input.opId),
          ),
          and(
            eq(dispositions.workingVersionId, project.workingVersionId),
            eq(dispositions.cellId, input.cellId),
            eq(dispositions.legacyId, input.legacyId),
          ),
        ),
      ),
    )
    .limit(1);
  if (!prior) return null;
  if (prior.opId !== input.opId || prior.fingerprint !== digest(input))
    fail(copy.intentMismatch, {
      statusCode: 409,
      errorCode: "intent_mismatch",
    });
  return notebookLegacyProposalRecoverySchema.parse(prior.receipt);
}

export async function readLegacyChange(
  tx: Queryable,
  scope: NotebookThreadScope,
  project: ProjectRow,
  input: LegacyProposalRecovery,
) {
  if (project.ownerEmail !== scope.ownerEmail) notebookUnavailable();
  const head = snapshotRef(scope, project).head;
  if (
    head.versionId !== input.head.versionId ||
    head.revision !== input.head.revision
  )
    fail(copy.baseChanged, {
      statusCode: 409,
      errorCode: "proposal_base_changed",
      details: { acceptedHead: head },
    });
  const [row] = await tx
    .select()
    .from(cells)
    .where(and(workingCells(project), eq(cells.id, input.cellId)))
    .limit(1);
  if (!row) orphanNotFound();
  const contents = decodeJsonColumn(row.contents, cellContentsSchema);
  if (contents?.kind !== "sql" || contents.pendingEdit?.id !== input.legacyId)
    orphanNotFound();
  return {
    revision: revisionSchema.parse(row.notebookRevision.toString()),
    source: contents.pendingEdit.source,
  };
}

export async function writeLegacyDisposition(
  tx: Queryable,
  scope: NotebookThreadScope,
  project: ProjectRow,
  input: LegacyProposalRecovery,
  proposalIds: string[],
) {
  const { cellId, legacyId, opId, decision } = input;
  const receipt = notebookLegacyProposalRecoverySchema.parse({
    cellId,
    legacyId,
    decision,
    proposalIds,
  });
  await tx.insert(dispositions).values({
    projectId: project.id,
    workingVersionId: project.workingVersionId,
    cellId,
    legacyId,
    actorId: scope.ownerEmail,
    opId,
    fingerprint: digest(input),
    receipt,
  });
  return receipt;
}

export async function recoverLegacyNotebookProposal(
  scope: NotebookThreadScope,
  input: LegacyProposalRecovery,
) {
  await ensureAnalyticsDatabase();
  const read = await getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(
      scope,
      input.projectId,
      tx,
      "update",
    );
    const binding =
      input.decision === "re-propose"
        ? await requireNotebookThreadBinding(scope, input, tx)
        : null;
    const prior = await readLegacyDisposition(tx, scope, project, input);
    if (prior) return { receipt: prior };
    const change = await readLegacyChange(tx, scope, project, input);
    if (input.decision === "discard")
      return {
        receipt: await writeLegacyDisposition(tx, scope, project, input, []),
      };
    return {
      change,
      projectId: snapshotRef(scope, project).projectId,
      binding,
    };
  });
  if (read.receipt) return read.receipt;
  if (!read.binding || input.decision !== "re-propose") orphanNotFound();
  const staged = await stageNotebookProposal(
    scope,
    {
      projectId: input.projectId,
      threadId: input.threadId,
      expectedOverlayRevision: revisionSchema.parse(
        read.binding.overlayRevision.toString(),
      ),
      command: {
        protocol: CONTRACT_VERSION,
        projectId: read.projectId,
        workingVersionId: input.head.versionId,
        observedHead: input.head,
        opId: input.opId,
        changes: [
          {
            type: "set-code",
            cellId: notebookCellIdSchema.parse(input.cellId),
            expectedRevision: read.change.revision,
            source: read.change.source,
          },
        ],
      },
    },
    { legacyRecovery: input },
    input,
  );
  return notebookLegacyProposalRecoverySchema.parse({
    cellId: input.cellId,
    legacyId: input.legacyId,
    decision: input.decision,
    proposalIds: staged.proposalIds,
  });
}
