import { parseIconValue } from "@agent-native/core/icons";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull } from "drizzle-orm";

import { nfmToDoc } from "../../shared/nfm.js";
import { getDb, schema } from "../db/index.js";
import { assertPrivateIconOwner } from "./private-icon-authority.js";

type Database = ReturnType<typeof getDb>;
type ElementType = "document" | "property" | "view" | "callout";

export function privateIconAssetId(icon: unknown): string | null {
  if (icon === undefined || icon === null || icon === "") return null;
  const parsed = parseIconValue(icon);
  return parsed?.kind === "image" && parsed.authority === "private-icon"
    ? parsed.assetId
    : null;
}

export async function verifyPrivateIconAssignment(input: {
  icon: unknown;
  userEmail: string;
  orgId: string | null;
}): Promise<string | null> {
  const assetId = privateIconAssetId(input.icon);
  if (assetId) {
    await assertPrivateIconOwner({
      assetId,
      ownerEmail: input.userEmail,
      orgId: input.orgId,
    });
  }
  return assetId;
}

export async function verifyPrivateIconCopiedFromDocument(
  db: Database,
  input: {
    sourceDocumentId: string;
    icon: unknown;
    ownerEmail: string;
    orgId: string | null;
  },
): Promise<void> {
  const assetId = privateIconAssetId(input.icon);
  if (!assetId) return;
  await assertAccess("document", input.sourceDocumentId, "viewer");
  const [source] = await db
    .select({
      icon: schema.documents.icon,
      ownerEmail: schema.documents.ownerEmail,
      orgId: schema.documents.orgId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, input.sourceDocumentId),
        isNull(schema.documents.trashedAt),
      ),
    )
    .limit(1);
  const [reference] = await db
    .select({ assetId: schema.privateIconReferences.assetId })
    .from(schema.privateIconReferences)
    .where(
      and(
        eq(schema.privateIconReferences.elementType, "document"),
        eq(schema.privateIconReferences.elementId, input.sourceDocumentId),
        eq(schema.privateIconReferences.documentId, input.sourceDocumentId),
        eq(schema.privateIconReferences.assetId, assetId),
        eq(schema.privateIconReferences.ownerEmail, input.ownerEmail),
        input.orgId === null
          ? isNull(schema.privateIconReferences.orgId)
          : eq(schema.privateIconReferences.orgId, input.orgId),
      ),
    )
    .limit(1);
  if (
    !source ||
    source.ownerEmail !== input.ownerEmail ||
    source.orgId !== input.orgId ||
    privateIconAssetId(source.icon) !== assetId ||
    !reference
  ) {
    throw new Error("Private icon is unavailable to this user.");
  }
}

export async function syncPrivateIconReference(
  db: Database,
  input: {
    elementType: ElementType;
    elementId: string;
    documentId: string;
    icon: unknown;
    ownerEmail: string;
    orgId: string | null;
  },
): Promise<void> {
  const assetId = privateIconAssetId(input.icon);
  await db
    .delete(schema.privateIconReferences)
    .where(
      and(
        eq(schema.privateIconReferences.elementType, input.elementType),
        eq(schema.privateIconReferences.elementId, input.elementId),
      ),
    );
  if (!assetId) return;
  await db.insert(schema.privateIconReferences).values({
    elementType: input.elementType,
    elementId: input.elementId,
    assetId,
    documentId: input.documentId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
  });
}

export function calloutPrivateIconAssetIds(content: string): Set<string> {
  const found = new Set<string>();
  const visit = (node: {
    type?: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
  }) => {
    if (node.type === "notionCallout") {
      const assetId = privateIconAssetId(node.attrs?.icon);
      if (assetId) found.add(assetId);
    }
    for (const child of node.content ?? []) {
      if (child && typeof child === "object") visit(child as typeof node);
    }
  };
  visit(nfmToDoc(content));
  return found;
}

export async function syncPrivateCalloutReferences(
  db: Database,
  input: {
    documentId: string;
    before: string;
    after: string;
    userEmail: string;
    ownerEmail: string;
    orgId: string | null;
    source?:
      | { kind: "document"; documentId: string }
      | { kind: "version"; versionId: string };
  },
): Promise<void> {
  if (!input.before.includes("<callout") && !input.after.includes("<callout"))
    return;
  const before = calloutPrivateIconAssetIds(input.before);
  const after = calloutPrivateIconAssetIds(input.after);
  let authorizedSourceAssets: Set<string> | undefined;
  if (input.source) {
    const [source] =
      input.source.kind === "document"
        ? await db
            .select({
              content: schema.documents.content,
              ownerEmail: schema.documents.ownerEmail,
              orgId: schema.documents.orgId,
            })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.id, input.source.documentId),
                isNull(schema.documents.trashedAt),
              ),
            )
            .limit(1)
        : await db
            .select({
              content: schema.documentVersions.content,
              ownerEmail: schema.documentVersions.ownerEmail,
              orgId: schema.documents.orgId,
            })
            .from(schema.documentVersions)
            .innerJoin(
              schema.documents,
              eq(schema.documents.id, schema.documentVersions.documentId),
            )
            .where(
              and(
                eq(schema.documentVersions.id, input.source.versionId),
                eq(schema.documentVersions.documentId, input.documentId),
              ),
            )
            .limit(1);
    if (
      !source ||
      source.ownerEmail !== input.ownerEmail ||
      source.orgId !== input.orgId ||
      source.content !== input.after
    ) {
      throw new Error("Private icon is unavailable to this user.");
    }
    if (input.source.kind === "document") {
      await assertAccess("document", input.source.documentId, "viewer");
    } else {
      await assertAccess("document", input.documentId, "editor");
    }
    authorizedSourceAssets = calloutPrivateIconAssetIds(source.content);
  }
  for (const assetId of after) {
    if (before.has(assetId)) continue;
    if (authorizedSourceAssets) {
      if (!authorizedSourceAssets.has(assetId))
        throw new Error("Private icon is unavailable to this user.");
      if (input.source?.kind === "document") {
        const [reference] = await db
          .select({ assetId: schema.privateIconReferences.assetId })
          .from(schema.privateIconReferences)
          .where(
            and(
              eq(schema.privateIconReferences.elementType, "callout"),
              eq(
                schema.privateIconReferences.elementId,
                `${input.source.documentId}:${assetId}`,
              ),
              eq(
                schema.privateIconReferences.documentId,
                input.source.documentId,
              ),
              eq(schema.privateIconReferences.assetId, assetId),
              eq(schema.privateIconReferences.ownerEmail, input.ownerEmail),
              input.orgId === null
                ? isNull(schema.privateIconReferences.orgId)
                : eq(schema.privateIconReferences.orgId, input.orgId),
            ),
          )
          .limit(1);
        if (!reference)
          throw new Error("Private icon is unavailable to this user.");
      }
    } else {
      await assertPrivateIconOwner({
        assetId,
        ownerEmail: input.userEmail,
        orgId: input.orgId,
      });
    }
    await db
      .insert(schema.privateIconReferences)
      .values({
        elementType: "callout",
        elementId: `${input.documentId}:${assetId}`,
        assetId,
        documentId: input.documentId,
        ownerEmail: input.ownerEmail,
        orgId: input.orgId,
      })
      .onConflictDoNothing();
  }
  for (const assetId of before) {
    if (after.has(assetId)) continue;
    await db
      .delete(schema.privateIconReferences)
      .where(
        and(
          eq(schema.privateIconReferences.elementType, "callout"),
          eq(
            schema.privateIconReferences.elementId,
            `${input.documentId}:${assetId}`,
          ),
        ),
      );
  }
}

export async function registerPrivateCalloutIcon(input: {
  documentId: string;
  assetId: string;
  userEmail: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<void> {
  await assertPrivateIconOwner({
    assetId: input.assetId,
    ownerEmail: input.userEmail,
    orgId: input.orgId,
  });
  const db = getDb();
  await db
    .insert(schema.privateIconReferences)
    .values({
      elementType: "callout",
      elementId: `${input.documentId}:${input.assetId}`,
      assetId: input.assetId,
      documentId: input.documentId,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    })
    .onConflictDoNothing();
}

export async function syncPrivateViewIconReferences(
  db: Database,
  input: {
    databaseId: string;
    documentId: string;
    views: Array<{ id: string; icon?: unknown }>;
    previousViews: Array<{ id: string; icon?: unknown }>;
    ownerEmail: string;
    orgId: string | null;
    userEmail: string;
  },
): Promise<void> {
  const previous = new Map(
    input.previousViews.map((view) => [
      view.id,
      privateIconAssetId(view.icon ?? null),
    ]),
  );
  const next = new Map(
    input.views.map((view) => [view.id, privateIconAssetId(view.icon ?? null)]),
  );
  for (const view of input.views) {
    if (previous.has(view.id) && previous.get(view.id) === next.get(view.id))
      continue;
    await verifyPrivateIconAssignment({
      icon: view.icon ?? null,
      userEmail: input.userEmail,
      orgId: input.orgId,
    });
    await syncPrivateIconReference(db, {
      elementType: "view",
      elementId: `${input.databaseId}:${view.id}`,
      documentId: input.documentId,
      icon: view.icon ?? null,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    });
  }
  for (const view of input.previousViews) {
    if (next.has(view.id)) continue;
    await syncPrivateIconReference(db, {
      elementType: "view",
      elementId: `${input.databaseId}:${view.id}`,
      documentId: input.documentId,
      icon: null,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    });
  }
}

async function isLiveReference(
  db: Database,
  reference: typeof schema.privateIconReferences.$inferSelect,
  viewer: { userEmail?: string | null; orgId?: string | null },
): Promise<boolean> {
  const access = await resolveAccess("document", reference.documentId, {
    userEmail: viewer.userEmail ?? undefined,
    orgId: viewer.orgId ?? undefined,
  });
  if (
    !access ||
    access.resource.trashedAt ||
    (access.resource.orgId ?? null) !== reference.orgId
  )
    return false;
  if (reference.elementType === "document") {
    return privateIconAssetId(access.resource.icon) === reference.assetId;
  }
  if (reference.elementType === "property") {
    const [property] = await db
      .select({
        icon: schema.documentPropertyDefinitions.icon,
        databaseId: schema.documentPropertyDefinitions.databaseId,
      })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, reference.elementId))
      .limit(1);
    if (
      !property ||
      privateIconAssetId(property.icon) !== reference.assetId ||
      !property.databaseId
    )
      return false;
    const [database] = await db
      .select({ documentId: schema.contentDatabases.documentId })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, property.databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      )
      .limit(1);
    return database?.documentId === reference.documentId;
  }
  if (reference.elementType === "view") {
    const separator = reference.elementId.indexOf(":");
    const databaseId = reference.elementId.slice(0, separator);
    const viewId = reference.elementId.slice(separator + 1);
    if (!databaseId || !viewId) return false;
    const [database] = await db
      .select({
        documentId: schema.contentDatabases.documentId,
        viewConfigJson: schema.contentDatabases.viewConfigJson,
      })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      )
      .limit(1);
    if (!database || database.documentId !== reference.documentId) return false;
    const parsed = JSON.parse(database.viewConfigJson) as {
      views?: Array<{ id?: string; icon?: unknown }>;
    };
    const view = parsed.views?.find((candidate) => candidate.id === viewId);
    return !!view && privateIconAssetId(view.icon) === reference.assetId;
  }
  if (reference.elementType === "callout") {
    return calloutPrivateIconAssetIds(access.resource.content).has(
      reference.assetId,
    );
  }
  return false;
}

export async function resolveReadablePrivateIcon(
  assetId: string,
  viewer: { userEmail?: string | null; orgId?: string | null },
): Promise<{ orgId: string | null } | null> {
  const db = getDb();
  let offset = 0;
  while (true) {
    const references = await db
      .select()
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.assetId, assetId))
      .orderBy(
        asc(schema.privateIconReferences.elementType),
        asc(schema.privateIconReferences.elementId),
      )
      .limit(100)
      .offset(offset);
    if (!references.length) return null;
    for (const reference of references) {
      if (await isLiveReference(db, reference, viewer)) {
        return { orgId: reference.orgId };
      }
    }
    if (references.length < 100) return null;
    offset += references.length;
  }
}
