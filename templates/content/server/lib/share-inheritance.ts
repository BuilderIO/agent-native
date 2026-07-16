import { eq } from "drizzle-orm";

import * as schema from "../db/schema.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

/**
 * Copy every explicit grant from one document to one or more children and
 * record the exact source/child share pair. Call this inside the same database
 * transaction as the child document mutation whenever one is already open.
 */
export async function inheritDocumentShares(args: {
  db: any;
  sourceResourceId: string;
  targetResourceIds: string[];
  createdBy?: string;
  createdAt: string;
}): Promise<number> {
  if (args.targetResourceIds.length === 0) return 0;

  const sourceShares = await loadSourceShares(args.db, args.sourceResourceId);
  return insertInheritedShares(args, sourceShares);
}

async function loadSourceShares(db: any, sourceResourceId: string) {
  return db
    .select({
      id: schema.documentShares.id,
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
      role: schema.documentShares.role,
      createdBy: schema.documentShares.createdBy,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, sourceResourceId));
}

async function insertInheritedShares(
  args: {
    db: any;
    sourceResourceId: string;
    targetResourceIds: string[];
    createdBy?: string;
    createdAt: string;
  },
  sourceShares: Awaited<ReturnType<typeof loadSourceShares>>,
): Promise<number> {
  if (sourceShares.length === 0) return 0;

  const copiedShares = args.targetResourceIds.flatMap((targetResourceId) =>
    sourceShares.map((sourceShare: (typeof sourceShares)[number]) => ({
      childShareId: nanoid(),
      sourceShare,
      targetResourceId,
    })),
  );

  await args.db.insert(schema.documentShares).values(
    copiedShares.map(({ childShareId, sourceShare, targetResourceId }) => ({
      id: childShareId,
      resourceId: targetResourceId,
      principalType: sourceShare.principalType,
      principalId: sourceShare.principalId,
      role: sourceShare.role,
      createdBy: args.createdBy ?? sourceShare.createdBy,
      createdAt: args.createdAt,
    })),
  );
  await args.db.insert(schema.documentShareInheritances).values(
    copiedShares.map(({ childShareId, sourceShare, targetResourceId }) => ({
      childShareId,
      sourceShareId: sourceShare.id,
      sourceResourceId: args.sourceResourceId,
      targetResourceId,
      createdAt: args.createdAt,
    })),
  );

  return copiedShares.length;
}

/**
 * Atomic wrapper for callers that are not already in a transaction. It checks
 * for source grants before opening a write transaction so child creation with
 * no grants does not needlessly contend on SQLite's single writer lock.
 */
export async function inheritDocumentSharesAtomically(args: {
  db: any;
  sourceResourceId: string;
  targetResourceIds: string[];
  createdBy?: string;
  createdAt: string;
}): Promise<number> {
  if (args.targetResourceIds.length === 0) return 0;
  const sourceShares = await loadSourceShares(args.db, args.sourceResourceId);
  if (sourceShares.length === 0) return 0;
  return args.db.transaction((tx: any) =>
    insertInheritedShares({ ...args, db: tx }, sourceShares),
  );
}
