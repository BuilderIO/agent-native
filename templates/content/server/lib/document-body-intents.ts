import { createHash } from "node:crypto";

import { and, asc, desc, eq, gt, lte } from "drizzle-orm";

import type { PriorDocumentBodyIntent } from "../../shared/document-intent-merge.js";
import type { DocumentBodyIntent } from "../../shared/document-intent-order.js";
import { getDb, schema } from "../db/index.js";

type ContentDb = ReturnType<typeof getDb>;

export async function readDocumentBodyIntents(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  afterRevision: number;
  throughRevision: number;
}): Promise<PriorDocumentBodyIntent[]> {
  const rows = await args.db
    .select()
    .from(schema.documentBodyIntents)
    .where(
      and(
        eq(schema.documentBodyIntents.ownerEmail, args.ownerEmail),
        eq(schema.documentBodyIntents.documentId, args.documentId),
        gt(schema.documentBodyIntents.committedRevision, args.afterRevision),
        lte(schema.documentBodyIntents.committedRevision, args.throughRevision),
      ),
    )
    .orderBy(asc(schema.documentBodyIntents.committedRevision));
  return rows.map((row) => ({
    writerId: row.writerId,
    operationId: row.operationId,
    ...(row.generation === null ? {} : { generation: row.generation }),
    authoredBaseRevision: row.authoredBaseRevision,
    committedRevision: row.committedRevision,
    affectedBlockIndexes: JSON.parse(row.affectedBlockIndexesJson) as number[],
    canonicalChanged: row.canonicalChanged,
  }));
}

export async function findDocumentBodyIntent(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  writerId: string;
  operationId: string;
}) {
  const [intent] = await args.db
    .select()
    .from(schema.documentBodyIntents)
    .where(
      and(
        eq(schema.documentBodyIntents.ownerEmail, args.ownerEmail),
        eq(schema.documentBodyIntents.documentId, args.documentId),
        eq(schema.documentBodyIntents.writerId, args.writerId),
        eq(schema.documentBodyIntents.operationId, args.operationId),
      ),
    )
    .limit(1);
  return intent ?? null;
}

export async function findDocumentBodyBase(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  contentHash: string;
  revision: number;
}): Promise<string | null> {
  const versions = await args.db
    .select({ content: schema.documentVersions.content })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, args.ownerEmail),
        eq(schema.documentVersions.documentId, args.documentId),
        eq(schema.documentVersions.bodyRevision, args.revision),
      ),
    )
    .orderBy(desc(schema.documentVersions.createdAt))
    .limit(500);
  return (
    versions.find(
      (version) =>
        `sha256:${createHash("sha256")
          .update(version.content)
          .digest("hex")}` === args.contentHash,
    )?.content ?? null
  );
}

export async function preserveDocumentBodyIntent(args: {
  db: ContentDb;
  ownerEmail: string;
  documentId: string;
  title: string;
  candidateContent: string;
  actorEmail: string | null;
  origin: string;
  operation: string;
  now: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await args.db.insert(schema.documentVersions).values({
    id,
    ownerEmail: args.ownerEmail,
    documentId: args.documentId,
    title: args.title,
    content: args.candidateContent,
    actorEmail: args.actorEmail,
    actorKind: args.origin === "frontend" ? "human" : "agent",
    origin: args.origin,
    groupKind: "operation",
    groupId: `body-intent:${id}`,
    operation: args.operation,
    checkpointKind: "recovery",
    createdAt: args.now,
    updatedAt: args.now,
  });
  return id;
}

export async function recordDocumentBodyIntent(args: {
  db: ContentDb;
  ownerEmail: string;
  orgId: string;
  documentId: string;
  intent: DocumentBodyIntent;
  candidateHash: string;
  metadataHash?: string;
  committedRevision: number;
  changedBlockIndexes: number[];
  canonicalChanged: boolean;
  displacedCheckpointId?: string;
  now: string;
}) {
  await args.db.insert(schema.documentBodyIntents).values({
    id: crypto.randomUUID(),
    ownerEmail: args.ownerEmail,
    orgId: args.orgId,
    documentId: args.documentId,
    writerId: args.intent.writerId,
    operationId: args.intent.operationId,
    candidateHash: args.candidateHash,
    metadataHash: args.metadataHash ?? null,
    generation: args.intent.generation ?? null,
    authoredBaseRevision: args.intent.authoredBaseRevision,
    committedRevision: args.committedRevision,
    affectedBlockIndexesJson: JSON.stringify(args.changedBlockIndexes),
    canonicalChanged: args.canonicalChanged,
    displacedCheckpointId: args.displacedCheckpointId ?? null,
    createdAt: args.now,
  });
}
