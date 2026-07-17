import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { resolveAccess } from "@agent-native/core/sharing";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import { buildDesignSnapshot } from "./design-snapshot.js";

export const nativeDesignCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "design",
  resourceType: "design",
  async capture(reference) {
    const access = await resolveAccess("design", reference.resourceId);
    if (!access) throw new Error("Design not found");
    const design = access.resource as typeof schema.designs.$inferSelect;
    if (reference.expectedUpdatedAt && reference.expectedUpdatedAt !== design.updatedAt) throw new Error("Design changed before it could be submitted to Context.");
    const snapshot = await buildDesignSnapshot(design.id, design.data);
    const payload = JSON.stringify({ designId: design.id, designData: design.data, files: snapshot.files, tweaks: snapshot.tweaks, appliedTweaks: snapshot.appliedTweaks, resolvedCssVars: snapshot.resolvedCssVars });
    const contentHash = createHash("sha256").update(payload).digest("hex");
    const versionId = nanoid();
    await getDb().insert(schema.designVersions).values({ id: versionId, designId: design.id, label: "Creative Context submission", snapshot: payload, createdAt: new Date().toISOString() });
    const handle = await putPrivateBlob({ data: Buffer.from(payload), filename: `${design.id}.design.json`, mimeType: "application/json", ownerEmail: design.ownerEmail, key: `creative-context/design/${design.id}/${contentHash}.json`, metadata: { appId: "design", resourceType: "design", resourceId: design.id, contentHash } });
    if (!handle) throw new Error("Private blob storage is required to submit a design to Context.");
    return { artifactKey: `design:design:${design.id}`, source: { name: "Design", kind: "manual", externalRef: design.id }, item: { externalId: `native:design:design:${design.id}`, kind: "design-project", title: design.title, canonicalUrl: `/design/${design.id}`, mimeType: "application/json", content: snapshot.files.map((file) => `${file.filename}\n${file.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}`).join("\n").slice(0, 40_000), summary: `${snapshot.files.length} saved design files captured as an immutable version.`, contentHash, sourceModifiedAt: design.updatedAt, sourceVersion: versionId, metadata: { preview: { type: "design", fileCount: snapshot.files.length }, children: snapshot.files.map((file) => ({ id: file.id, title: file.filename, type: file.fileType })) } }, privateMetadata: { clone: { handle, contentHash, sourceVersion: versionId, updatedAt: design.updatedAt } } };
  },
};
