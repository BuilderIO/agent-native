import { createHash, randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveDocumentHistoryCause } from "../server/lib/document-history.js";
import {
  duplicateDocumentResultSchema,
  type DuplicateDocumentResult,
} from "../shared/duplicate-document.js";
import { persistBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import {
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";

type Db = ReturnType<typeof getDb>;
type Page = typeof schema.documents.$inferSelect;
const MAX_PAGES = 500;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

function reject(code: string, message: string): never {
  throw new ActionContractError(message, { errorCode: code, statusCode: 409 });
}

function checkPayload(value: string) {
  if (
    /(?:\b(?:data|blob|private-blob):|["']opaque["']\s*:\s*true|<InlineDatabase\b|<SourceComponent\b)/i.test(
      value,
    )
  ) {
    reject(
      "UNSUPPORTED_DUPLICATE_PAYLOAD",
      "This page contains content that cannot be safely duplicated.",
    );
  }
}

async function assertNativePages(db: Db, pages: Page[]) {
  if (
    pages.some(
      (page) =>
        (page.sourceMode !== null && page.sourceMode !== "database") ||
        page.sourceKind !== null ||
        page.sourcePath !== null ||
        page.sourceRootPath !== null ||
        page.sourceUpdatedAt !== null,
    )
  )
    reject(
      "SOURCE_DUPLICATION_UNSUPPORTED",
      "The page tree contains connected source content.",
    );
  const ids = pages.map((page) => page.id);
  const [databases, references, links, sourceRows] = await Promise.all([
    db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(inArray(schema.contentDatabases.documentId, ids))
      .limit(1),
    db
      .select({ id: schema.contentSpaceCatalogItems.id })
      .from(schema.contentSpaceCatalogItems)
      .where(inArray(schema.contentSpaceCatalogItems.documentId, ids))
      .limit(1),
    db
      .select({ id: schema.documentSyncLinks.documentId })
      .from(schema.documentSyncLinks)
      .where(inArray(schema.documentSyncLinks.documentId, ids))
      .limit(1),
    db
      .select({ id: schema.contentDatabaseSourceRows.id })
      .from(schema.contentDatabaseSourceRows)
      .where(inArray(schema.contentDatabaseSourceRows.documentId, ids))
      .limit(1),
  ]);
  if (databases.length || references.length)
    reject(
      "PAGE_TREE_REQUIRED",
      "Only native Pages and their native child Pages can be duplicated.",
    );
  if (links.length || sourceRows.length)
    reject(
      "SOURCE_DUPLICATION_UNSUPPORTED",
      "The page tree contains connected source content.",
    );
}

async function readTree(db: Db, rootId: string): Promise<Page[]> {
  const context = currentAccess();
  const [root] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, rootId),
        isNull(schema.documents.trashedAt),
        accessFilter(
          schema.documents,
          schema.documentShares,
          context,
          "editor",
        ),
      ),
    );
  if (!root)
    reject(
      "PAGE_UNAVAILABLE",
      "The page is unavailable or requires editor access.",
    );
  const pages = [root];
  const seen = new Set([root.id]);
  let frontier = [root.id];
  while (frontier.length) {
    // Containment discovery reads only opaque IDs before checking every child's access.
    const children = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.parentId, frontier),
          isNull(schema.documents.trashedAt),
        ),
      )
      .limit(MAX_PAGES + 1);
    if (!children.length) break;
    if (pages.length + children.length > MAX_PAGES)
      reject(
        "DUPLICATE_LIMIT",
        "This page tree is too large to duplicate in one operation.",
      );
    if (children.some((child) => seen.has(child.id)))
      reject("INVALID_PAGE_TREE", "The page hierarchy contains a cycle.");
    frontier = children.map((child) => child.id);
    const authorized = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, frontier),
          accessFilter(
            schema.documents,
            schema.documentShares,
            context,
            "editor",
          ),
        ),
      )
      .orderBy(asc(schema.documents.position), asc(schema.documents.id));
    if (authorized.length !== frontier.length)
      reject(
        "PAGE_TREE_UNAVAILABLE",
        "The complete page tree is not available for duplication.",
      );
    for (const child of authorized) {
      if (
        child.spaceId !== root.spaceId ||
        child.ownerEmail !== root.ownerEmail ||
        child.orgId !== root.orgId
      ) {
        reject(
          "INVALID_PAGE_TREE",
          "The page tree crosses ownership or Content space boundaries.",
        );
      }
      seen.add(child.id);
      pages.push(child);
    }
  }
  await assertNativePages(db, pages);
  if (root.parentId) {
    const [databaseParent] = await db
      .select({ id: schema.contentDatabases.id })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, root.parentId))
      .limit(1);
    if (databaseParent)
      reject(
        "AMBIGUOUS_DATABASE_PARENT",
        "Use a database row operation for a Page with a database parent.",
      );
  }
  return pages;
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    candidate.code === "40001" ||
    candidate.code === "40P01" ||
    candidate.code === "23505" ||
    retryable(candidate.cause)
  );
}

export async function duplicateDocumentTree(args: {
  id: string;
  idempotencyKey: string;
  ctx?: ActionRunContext;
}): Promise<DuplicateDocumentResult> {
  const authority = currentAccess();
  if (!authority.userEmail)
    throw new ActionContractError("Authentication is required.", {
      errorCode: "AUTH_REQUIRED",
      statusCode: 401,
    });
  const ownerEmail = authority.userEmail.toLowerCase();
  const callerScope = JSON.stringify([ownerEmail, authority.orgId ?? null]);
  const payloadDigest = createHash("sha256")
    .update(
      JSON.stringify({
        id: args.id,
        destination: "same-space-root",
        version: 1,
      }),
    )
    .digest("hex");
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    try {
      return await withPositionLock(
        documentsPositionScope(ownerEmail, null),
        () =>
          db.transaction(
            async (transaction) => {
              const tx = transaction as unknown as Db;
              const [stored] = await tx
                .select()
                .from(schema.documentDuplicationReceipts)
                .where(
                  and(
                    eq(
                      schema.documentDuplicationReceipts.callerScope,
                      callerScope,
                    ),
                    eq(
                      schema.documentDuplicationReceipts.idempotencyKey,
                      args.idempotencyKey,
                    ),
                  ),
                );
              if (stored) {
                if (stored.payloadDigest !== payloadDigest)
                  reject(
                    "IDEMPOTENCY_KEY_REUSED",
                    "This retry key was used for a different duplication.",
                  );
                const result = duplicateDocumentResultSchema.parse(
                  JSON.parse(stored.resultJson),
                );
                if (
                  result.sourceDocumentId !== args.id ||
                  result.documentIds.length !== result.duplicatedCount ||
                  result.documentIds[0].id !== result.id ||
                  result.documentIds[0].sourceId !== args.id
                ) {
                  reject(
                    "INVALID_DUPLICATE_RECEIPT",
                    "The saved duplication receipt is inconsistent.",
                  );
                }
                const visible = await tx
                  .select({ id: schema.documents.id })
                  .from(schema.documents)
                  .where(
                    and(
                      eq(schema.documents.id, result.id),
                      accessFilter(
                        schema.documents,
                        schema.documentShares,
                        authority,
                      ),
                      isNull(schema.documents.trashedAt),
                    ),
                  );
                if (!visible.length)
                  reject(
                    "DUPLICATE_UNAVAILABLE",
                    "The previously duplicated page is no longer available.",
                  );
                return { ...result, replayed: true };
              }

              const pages = await readTree(tx, args.id);
              const root = pages[0];
              if (!root.spaceId)
                reject(
                  "SPACE_REQUIRED",
                  "The page must belong to a Content space.",
                );
              const spaceAccess = await resolveContentSpaceAccess(
                root.spaceId,
                "contributor",
                { db: tx },
              ).catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  /^(?:Not authorized for Content space|Contributor access is required|Content space .* not found)/.test(
                    error.message,
                  )
                ) {
                  reject(
                    "SPACE_CREATION_DENIED",
                    "You cannot create a private copy in this Content space.",
                  );
                }
                throw error;
              });
              const [files] = await tx
                .select()
                .from(schema.contentDatabases)
                .where(
                  and(
                    eq(
                      schema.contentDatabases.id,
                      spaceAccess.space.filesDatabaseId,
                    ),
                    eq(schema.contentDatabases.spaceId, root.spaceId),
                    eq(schema.contentDatabases.systemRole, "files"),
                    isNull(schema.contentDatabases.deletedAt),
                  ),
                );
              if (!files?.primaryBlocksPropertyId)
                reject(
                  "FILES_UNAVAILABLE",
                  "The Content space Files database is not ready.",
                );
              const ids = pages.map((page) => page.id);
              const values = await tx
                .select()
                .from(schema.documentPropertyValues)
                .where(inArray(schema.documentPropertyValues.documentId, ids));
              const extraFields = await tx
                .select()
                .from(schema.documentBlockFieldContents)
                .where(
                  inArray(schema.documentBlockFieldContents.documentId, ids),
                );
              const propertyIds = [
                ...new Set(
                  [...values, ...extraFields].map((value) => value.propertyId),
                ),
              ];
              const definitions = propertyIds.length
                ? await tx
                    .select()
                    .from(schema.documentPropertyDefinitions)
                    .where(
                      inArray(
                        schema.documentPropertyDefinitions.id,
                        propertyIds,
                      ),
                    )
                : [];
              const properties = new Map(
                definitions.map((definition) => [definition.id, definition]),
              );
              if (propertyIds.some((id) => !properties.has(id)))
                reject(
                  "PROPERTY_UNAVAILABLE",
                  "The page contains an unavailable property definition.",
                );
              const pageProperty = (id: string) =>
                properties.get(id)!.databaseId === null;
              const ownedValues = values.filter((value) =>
                pageProperty(value.propertyId),
              );
              const ownedFields = extraFields.filter((field) =>
                pageProperty(field.propertyId),
              );
              const ownedDefinitions = new Map(
                definitions
                  .filter((definition) => definition.databaseId === null)
                  .map((definition) => [definition.id, definition]),
              );
              const definitionOptions = new Map<
                string,
                Record<string, unknown>
              >();
              for (const definition of ownedDefinitions.values()) {
                let options: Record<string, unknown>;
                try {
                  options = JSON.parse(definition.optionsJson);
                  if (
                    !options ||
                    typeof options !== "object" ||
                    Array.isArray(options)
                  )
                    throw new Error("Invalid options");
                } catch {
                  reject(
                    "PROPERTY_UNAVAILABLE",
                    "A Page property definition could not be read.",
                  );
                }
                definitionOptions.set(definition.id, options);
                const rollup = options.rollup as
                  | { relationPropertyId?: unknown }
                  | undefined;
                const dependencyId = rollup?.relationPropertyId;
                if (dependencyId != null && typeof dependencyId !== "string")
                  reject(
                    "PROPERTY_UNAVAILABLE",
                    "A Page property dependency is invalid.",
                  );
                if (
                  typeof dependencyId === "string" &&
                  !ownedDefinitions.has(dependencyId)
                ) {
                  const [dependency] = await tx
                    .select()
                    .from(schema.documentPropertyDefinitions)
                    .where(
                      eq(schema.documentPropertyDefinitions.id, dependencyId),
                    );
                  if (
                    !dependency ||
                    dependency.databaseId !== null ||
                    dependency.ownerEmail !== definition.ownerEmail
                  )
                    reject(
                      "PROPERTY_UNAVAILABLE",
                      "A Page property depends on a definition that cannot be duplicated.",
                    );
                  ownedDefinitions.set(dependency.id, dependency);
                }
                if (ownedDefinitions.size > 500)
                  reject(
                    "DUPLICATE_LIMIT",
                    "This page tree has too many property definitions to duplicate.",
                  );
              }
              const propertyRemap = new Map(
                [...ownedDefinitions.keys()].map((id) => [id, randomUUID()]),
              );
              for (const value of ownedValues) {
                try {
                  JSON.parse(value.valueJson);
                } catch {
                  reject(
                    "INVALID_PROPERTY_VALUE",
                    "A Page property could not be read. Repair it before duplicating.",
                  );
                }
              }
              const pageById = new Map(pages.map((page) => [page.id, page]));
              for (const value of [...ownedValues, ...ownedFields]) {
                const definition = properties.get(value.propertyId)!;
                if (
                  definition.ownerEmail !==
                    pageById.get(value.documentId)!.ownerEmail ||
                  value.ownerEmail !== definition.ownerEmail
                ) {
                  reject(
                    "PROPERTY_UNAVAILABLE",
                    "The page contains a property with incompatible ownership.",
                  );
                }
              }
              let bytes = 0;
              for (const content of [
                ...pages.map((page) => page.content),
                ...ownedFields.map((field) => field.content),
                ...ownedValues.map((value) => value.valueJson),
                ...[...ownedDefinitions.values()].map(
                  (definition) => definition.optionsJson,
                ),
              ]) {
                checkPayload(content);
                bytes += Buffer.byteLength(content);
              }
              if (bytes > MAX_CONTENT_BYTES)
                reject(
                  "DUPLICATE_LIMIT",
                  "This page tree is too large to duplicate in one operation.",
                );

              const now = new Date().toISOString();
              const receiptId = randomUUID();
              const documentIds = pages.map((page) => ({
                sourceId: page.id,
                id: randomUUID(),
              }));
              const remap = new Map(
                documentIds.map((entry) => [entry.sourceId, entry.id]),
              );
              const [position] = await tx
                .select({
                  max: sql<number>`coalesce(max(${schema.documents.position}), -1)`,
                })
                .from(schema.documents)
                .where(
                  and(
                    eq(schema.documents.ownerEmail, ownerEmail),
                    isNull(schema.documents.parentId),
                  ),
                );
              const rootPosition = nextAppendPosition(position.max);
              if (!Number.isSafeInteger(rootPosition))
                reject("INVALID_POSITION", "The destination order is invalid.");
              const cause = {
                ...resolveDocumentHistoryCause({
                  ctx: args.ctx,
                  operation: "duplicate-document",
                  actorEmail: ownerEmail,
                }),
                groupId: receiptId,
              };
              for (const page of pages) {
                const id = remap.get(page.id)!;
                await tx.insert(schema.documents).values({
                  id,
                  parentId:
                    page.id === root.id ? null : remap.get(page.parentId!)!,
                  spaceId: root.spaceId,
                  ownerEmail,
                  orgId: spaceAccess.space.orgId,
                  visibility: "private",
                  title: page.title,
                  content: page.content,
                  description: page.description,
                  icon: page.icon,
                  hideFromSearch: page.hideFromSearch,
                  position: page.id === root.id ? rootPosition : page.position,
                  createdAt: now,
                  updatedAt: now,
                });
                await tx.insert(schema.documentVersions).values({
                  id: randomUUID(),
                  documentId: id,
                  ownerEmail,
                  title: page.title,
                  content: page.content,
                  ...cause,
                  checkpointKind: "after",
                  createdAt: now,
                  updatedAt: now,
                });
                await persistBlocksFieldIdentity({
                  db: tx,
                  ownerEmail,
                  documentId: id,
                  propertyId: files.primaryBlocksPropertyId,
                  previousMarkdown: "",
                  markdown: page.content,
                  now,
                });
              }
              for (const definition of ownedDefinitions.values()) {
                const options = definitionOptions.get(definition.id)!;
                const rollup = options.rollup as
                  | { relationPropertyId?: string | null }
                  | undefined;
                // Only the host's relation property is a local dependency. The rollup's
                // target property belongs to referenced Pages, whose identities stay put.
                const optionsJson = JSON.stringify(
                  rollup?.relationPropertyId
                    ? {
                        ...options,
                        rollup: {
                          ...rollup,
                          relationPropertyId: propertyRemap.get(
                            rollup.relationPropertyId,
                          )!,
                        },
                      }
                    : options,
                );
                await tx
                  .insert(schema.documentPropertyDefinitions)
                  .values({
                    ...definition,
                    id: propertyRemap.get(definition.id)!,
                    ownerEmail,
                    orgId: spaceAccess.space.orgId,
                    optionsJson,
                    createdAt: now,
                    updatedAt: now,
                  });
              }
              for (const value of ownedValues) {
                await tx.insert(schema.documentPropertyValues).values({
                  id: randomUUID(),
                  documentId: remap.get(value.documentId)!,
                  ownerEmail,
                  propertyId: propertyRemap.get(value.propertyId)!,
                  valueJson: value.valueJson,
                  createdAt: now,
                  updatedAt: now,
                });
              }
              for (const field of ownedFields) {
                const documentId = remap.get(field.documentId)!;
                await tx.insert(schema.documentBlockFieldContents).values({
                  id: randomUUID(),
                  documentId,
                  ownerEmail,
                  propertyId: propertyRemap.get(field.propertyId)!,
                  content: field.content,
                  createdAt: now,
                  updatedAt: now,
                });
                await persistBlocksFieldIdentity({
                  db: tx,
                  ownerEmail,
                  documentId,
                  propertyId: propertyRemap.get(field.propertyId)!,
                  previousMarkdown: "",
                  markdown: field.content,
                  now,
                });
              }
              await ensureDocumentsFilesMembership(
                tx,
                documentIds.map((entry) => entry.id),
                now,
                ownerEmail,
              );
              const result: DuplicateDocumentResult = {
                id: documentIds[0].id,
                sourceDocumentId: args.id,
                duplicatedCount: pages.length,
                documentIds,
                replayed: false,
                placement: "root",
                visibility: "private",
                spaceId: root.spaceId,
              };
              await tx.insert(schema.documentDuplicationReceipts).values({
                id: receiptId,
                callerScope,
                idempotencyKey: args.idempotencyKey,
                payloadDigest,
                sourceDocumentId: args.id,
                resultJson: JSON.stringify(result),
                createdAt: now,
              });
              return result;
            },
            { isolationLevel: "serializable" },
          ),
      );
    } catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
    }
  }
}
