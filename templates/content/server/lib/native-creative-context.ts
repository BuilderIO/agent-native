import { createHash, randomUUID } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";
import { and, inArray } from "drizzle-orm";

import { flushOpenDocumentEditorToSql } from "../../actions/_document-flush.js";
import { getDb, schema } from "../db/index.js";

function documentPreview(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headings = lines
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .trim()
        .slice(0, 160),
    )
    .filter(Boolean)
    .slice(0, 8);
  const excerpt = lines
    .filter((line) => !/^\s*(?:```|#{1,6}\s+)/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500);
  let inCode = false;
  const blocks = lines.slice(0, 240).flatMap((rawLine) => {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inCode = !inCode;
      return [];
    }
    if (!line) return [];
    if (inCode) {
      return [{ kind: "code" as const, text: rawLine.slice(0, 600) }];
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      return [
        {
          kind: "heading" as const,
          text: (heading[2] ?? "").slice(0, 300),
          level: heading[1]?.length ?? 1,
        },
      ];
    }
    const bullet = /^(?:[-*+] |\d+[.)] )(.+)$/.exec(line);
    if (bullet) {
      return [
        { kind: "bullet" as const, text: (bullet[1] ?? "").slice(0, 600) },
      ];
    }
    if (line.startsWith(">")) {
      return [
        { kind: "quote" as const, text: line.slice(1).trim().slice(0, 600) },
      ];
    }
    return [{ kind: "paragraph" as const, text: line.slice(0, 600) }];
  });
  return {
    type: "document" as const,
    headings,
    excerpt,
    blocks: blocks.slice(0, 40),
  };
}

export const nativeDocumentCreativeContextAdapter: NativeResourceCaptureAdapter =
  {
    appId: "content",
    resourceType: "document",
    async listResourceVersions(resourceIds) {
      if (!resourceIds.length) return [];
      return getDb()
        .select({
          resourceId: schema.documents.id,
          sourceModifiedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.id, [...resourceIds]),
            accessFilter(schema.documents, schema.documentShares),
          ),
        );
    },
    async capture(reference) {
      const access = await resolveAccess("document", reference.resourceId);
      if (!access) throw new Error("Document not found");
      const initial = access.resource as typeof schema.documents.$inferSelect;
      if (
        reference.expectedUpdatedAt &&
        reference.expectedUpdatedAt !== initial.updatedAt
      )
        throw new Error(
          "Document changed before it could be submitted to Context.",
        );
      await flushOpenDocumentEditorToSql({
        documentId: initial.id,
        ownerEmail: initial.ownerEmail ?? null,
      });
      const refreshed = await resolveAccess("document", initial.id);
      if (!refreshed) throw new Error("Document not found");
      const document =
        refreshed.resource as typeof schema.documents.$inferSelect;
      const contentHash = createHash("sha256")
        .update(document.content)
        .digest("hex");
      const versionId = randomUUID();
      await getDb().insert(schema.documentVersions).values({
        id: versionId,
        ownerEmail: document.ownerEmail,
        documentId: document.id,
        title: document.title,
        content: document.content,
        createdAt: new Date().toISOString(),
      });
      const handle = await putPrivateBlob({
        data: Buffer.from(document.content),
        filename: `${document.id}.md`,
        mimeType: "text/markdown",
        ownerEmail: document.ownerEmail,
        key: `creative-context/content/${document.id}/${contentHash}.md`,
        metadata: {
          appId: "content",
          resourceType: "document",
          resourceId: document.id,
          contentHash,
        },
      });
      if (!handle)
        throw new Error(
          "Private blob storage is required to submit a document to Context.",
        );
      return {
        artifactKey: `content:document:${document.id}`,
        source: {
          name: "Content",
          kind: "native-app",
          externalRef: document.id,
          access: {
            visibility: document.visibility ?? "private",
            canManage: refreshed.role === "owner" || refreshed.role === "admin",
          },
        },
        items: [
          {
            externalId: `native:content:document:${document.id}`,
            kind: "document",
            title: document.title,
            canonicalUrl: `/page/${document.id}`,
            mimeType: "text/markdown",
            content: document.content.slice(0, 40_000),
            summary: document.description ?? "Immutable Markdown document.",
            contentHash,
            sourceModifiedAt: document.updatedAt,
            sourceVersion: versionId,
            metadata: { preview: documentPreview(document.content) },
          },
        ],
        privateMetadata: {
          nativeResource: {
            appId: "content",
            resourceType: "document",
            resourceId: document.id,
            expectedUpdatedAt: reference.expectedUpdatedAt,
          },
          clone: {
            handle,
            appId: "content",
            resourceType: "document",
            resourceId: document.id,
            contentHash,
            sourceVersion: versionId,
            updatedAt: document.updatedAt,
          },
        },
      };
    },
  };
