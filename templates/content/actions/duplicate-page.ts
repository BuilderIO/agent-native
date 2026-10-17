import { defineAction } from "@agent-native/core/action";
import { ActionContractError } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";
import {
  assertSubtreeCanChangeSpace,
  loadPageSubtree,
  subtreeCollectionDocumentIds,
  type PageSubtreeDocument,
} from "./_page-subtree.js";
import createDocument from "./create-document.js";
import deleteDocument from "./delete-document.js";
import moveDocument from "./move-document.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

async function canRead(documentId: string) {
  try {
    await assertAccess("document", documentId, "viewer");
    return true;
  } catch {
    // coercion-ok: callers treat any denial as "cannot read" and refuse.
    return false;
  }
}

export default defineAction({
  description:
    "Duplicate a page and all of its sub-pages. By default the copy sits right after the original under the same parent; pass spaceId to copy it into another Content space (top level, or under parentId there). Each copy is placed exactly as if the caller created it there: it takes the destination parent's owner and sharing, or belongs to the caller with the space's default access. Requires edit access to the page and read access to every sub-page. Collections inside the page are not copied; the copy keeps pointing at them within the same space, and pages containing collections cannot be copied to another space. Comments and history are not copied.",
  schema: z.object({
    documentId: z.string().describe("Page to duplicate"),
    spaceId: z
      .string()
      .optional()
      .describe(
        "Destination Content space ID from list-content-spaces. Defaults to the page's own space.",
      ),
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Parent page for the copy, or null for the top level. Defaults to the original's parent in the same space, or the top level in another space.",
      ),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const access = await assertAccess("document", args.documentId, "editor");
    const source = access.resource as PageSubtreeDocument;
    if (source.trashedAt) {
      throw new ActionContractError("Pages in Trash can't be duplicated.", {
        errorCode: "PAGE_TRASHED",
        statusCode: 409,
      });
    }
    const db = getDb();
    const sameSpace = !args.spaceId || args.spaceId === source.spaceId;
    const spaceId = args.spaceId ?? source.spaceId;
    const parentId =
      args.parentId !== undefined
        ? args.parentId
        : sameSpace
          ? source.parentId
          : null;

    if (parentId) {
      const [parent] = await db
        .select({ spaceId: schema.documents.spaceId })
        .from(schema.documents)
        .where(eq(schema.documents.id, parentId));
      if (!parent || parent.spaceId !== spaceId) {
        throw new ActionContractError(
          "The parent page must be in the destination Content space.",
          { errorCode: "PARENT_SPACE_MISMATCH", statusCode: 409 },
        );
      }
    }

    const subtree = await loadPageSubtree(db, source, {
      includeTrashed: false,
    });
    if (!sameSpace) await assertSubtreeCanChangeSpace(db, subtree);

    const collectionDocumentIds = await subtreeCollectionDocumentIds(
      db,
      subtree.map((document) => document.id),
    );
    if (collectionDocumentIds.has(source.id)) {
      throw new ActionContractError(
        "Collections can't be duplicated with duplicate-page.",
        { errorCode: "PAGE_IS_COLLECTION", statusCode: 409 },
      );
    }
    const copies = new Map<string, string>();
    const pages: PageSubtreeDocument[] = [];
    for (const document of subtree) {
      if (collectionDocumentIds.has(document.id)) continue;
      if (document.id !== source.id) {
        if (!document.parentId || !copies.has(document.parentId)) continue;
        if (!(await canRead(document.id))) {
          throw new ActionContractError(
            "This page has sub-pages you can't open, so it can't be duplicated completely.",
            { errorCode: "PAGE_SUBTREE_INACCESSIBLE", statusCode: 403 },
          );
        }
      }
      pages.push(document);
      copies.set(document.id, "");
    }

    const copiedFromLastSave: string[] = [];
    for (const page of pages) {
      try {
        await flushOpenDocumentEditorToSql({
          documentId: page.id,
          ownerEmail: page.ownerEmail,
        });
      } catch (error) {
        console.warn("[duplicate-page] live editor flush failed", error);
        copiedFromLastSave.push(page.id);
      }
    }
    const fresh = new Map<string, PageSubtreeDocument>();
    for (const row of await db
      .select()
      .from(schema.documents)
      .where(
        inArray(
          schema.documents.id,
          pages.map((page) => page.id),
        ),
      )) {
      fresh.set(row.id, row);
    }

    let rootCopyId: string | null = null;
    try {
      for (const page of pages) {
        const current = fresh.get(page.id) ?? page;
        const isRoot = page.id === source.id;
        const copyParentId = isRoot ? parentId : copies.get(page.parentId!)!;
        const created = await createDocument.run({
          title: isRoot ? `Copy of ${current.title}` : current.title,
          content: current.content ?? "",
          ...(current.icon ? { icon: current.icon } : {}),
          ...(copyParentId
            ? { parentId: copyParentId }
            : { spaceId: spaceId ?? undefined }),
        } as any);
        copies.set(page.id, created.id);
        if (isRoot) rootCopyId = created.id;
      }

      if (sameSpace) {
        const values = await db
          .select()
          .from(schema.documentPropertyValues)
          .where(
            inArray(
              schema.documentPropertyValues.documentId,
              pages.map((page) => page.id),
            ),
          );
        const owners = new Map<string, string>();
        for (const row of await db
          .select({
            id: schema.documents.id,
            ownerEmail: schema.documents.ownerEmail,
          })
          .from(schema.documents)
          .where(inArray(schema.documents.id, [...copies.values()]))) {
          owners.set(row.id, row.ownerEmail);
        }
        const now = new Date().toISOString();
        const inserts = values.flatMap((value) => {
          const copyId = copies.get(value.documentId);
          if (!copyId) return [];
          return [
            {
              id: nanoid(),
              ownerEmail: owners.get(copyId) ?? userEmail,
              documentId: copyId,
              propertyId: value.propertyId,
              valueJson: value.valueJson,
              createdAt: now,
              updatedAt: now,
            },
          ];
        });
        if (inserts.length > 0) {
          await db.insert(schema.documentPropertyValues).values(inserts);
        }
        const fieldContents = await db
          .select()
          .from(schema.documentBlockFieldContents)
          .where(
            inArray(
              schema.documentBlockFieldContents.documentId,
              pages.map((page) => page.id),
            ),
          );
        const fieldInserts = fieldContents.flatMap((field) => {
          const copyId = copies.get(field.documentId);
          if (!copyId) return [];
          return [
            {
              id: nanoid(),
              ownerEmail: owners.get(copyId) ?? userEmail,
              documentId: copyId,
              propertyId: field.propertyId,
              content: field.content,
              createdAt: now,
              updatedAt: now,
            },
          ];
        });
        if (fieldInserts.length > 0) {
          await db
            .insert(schema.documentBlockFieldContents)
            .values(fieldInserts);
        }
      }

      if (sameSpace && parentId === source.parentId && rootCopyId) {
        await moveDocument.run({
          id: rootCopyId,
          position: source.position + 1,
        });
      }
    } catch (error) {
      if (rootCopyId) {
        try {
          await deleteDocument.run({ id: rootCopyId });
        } catch (cleanupError) {
          console.warn(
            "[duplicate-page] could not remove partial copy",
            cleanupError,
          );
        }
      }
      throw error;
    }

    const [copy] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, rootCopyId!));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      id: copy.id,
      urlPath: `/page/${copy.id}`,
      title: copy.title,
      spaceId: copy.spaceId,
      parentId: copy.parentId,
      copiedCount: pages.length,
      copiedFromLastSave,
    };
  },
});
