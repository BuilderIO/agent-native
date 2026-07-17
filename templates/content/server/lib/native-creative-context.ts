import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { resolveAccess } from "@agent-native/core/sharing";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import { flushOpenDocumentEditorToSql } from "../../actions/_document-flush.js";

export const nativeDocumentCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "content",
  resourceType: "document",
  async capture(reference) {
    const access = await resolveAccess("document", reference.resourceId);
    if (!access) throw new Error("Document not found");
    const initial = access.resource as typeof schema.documents.$inferSelect;
    if (reference.expectedUpdatedAt && reference.expectedUpdatedAt !== initial.updatedAt) throw new Error("Document changed before it could be submitted to Context.");
    await flushOpenDocumentEditorToSql({ documentId: initial.id, ownerEmail: initial.ownerEmail ?? null });
    const refreshed = await resolveAccess("document", initial.id);
    if (!refreshed) throw new Error("Document not found");
    const document = refreshed.resource as typeof schema.documents.$inferSelect;
    const contentHash = createHash("sha256").update(document.content).digest("hex");
    const versionId = nanoid();
    await getDb().insert(schema.documentVersions).values({ id: versionId, ownerEmail: document.ownerEmail, documentId: document.id, title: document.title, content: document.content, createdAt: new Date().toISOString() });
    const handle = await putPrivateBlob({ data: Buffer.from(document.content), filename: `${document.id}.md`, mimeType: "text/markdown", ownerEmail: document.ownerEmail, key: `creative-context/content/${document.id}/${contentHash}.md`, metadata: { appId: "content", resourceType: "document", resourceId: document.id, contentHash } });
    if (!handle) throw new Error("Private blob storage is required to submit a document to Context.");
    return { artifactKey: `content:document:${document.id}`, source: { name: "Content", kind: "manual", externalRef: document.id }, item: { externalId: `native:content:document:${document.id}`, kind: "document", title: document.title, canonicalUrl: `/page/${document.id}`, mimeType: "text/markdown", content: document.content.slice(0, 40_000), summary: document.description ?? "Immutable Markdown document.", contentHash, sourceModifiedAt: document.updatedAt, sourceVersion: versionId, metadata: { preview: { type: "markdown" } }, }, privateMetadata: { clone: { handle, contentHash, sourceVersion: versionId, updatedAt: document.updatedAt } } };
  },
};
