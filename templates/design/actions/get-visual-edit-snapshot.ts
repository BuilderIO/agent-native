import { defineAction } from "@agent-native/core/action";
import {
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function parsePrivateBlobHandle(value: string): PrivateBlobHandle {
  let handle: unknown;
  try {
    handle = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Stored visual-edit snapshot handle is malformed.");
  }
  if (
    !handle ||
    typeof handle !== "object" ||
    !("id" in handle) ||
    typeof handle.id !== "string" ||
    !handle.id ||
    !("provider" in handle) ||
    typeof handle.provider !== "string" ||
    !handle.provider ||
    !("opaque" in handle) ||
    handle.opaque !== true ||
    !("encrypted" in handle) ||
    typeof handle.encrypted !== "boolean"
  ) {
    throw new Error("Stored visual-edit snapshot handle is invalid.");
  }
  return handle as PrivateBlobHandle;
}

export default defineAction({
  description:
    "Read the latest shared HTML fallback for one Localhost screen. Design access is required; the owner's local server is never contacted.",
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
    fileId: z.string().min(1).describe("Localhost screen file ID."),
    knownUpdatedAt: z
      .string()
      .nullable()
      .optional()
      .describe("Timestamp of the latest snapshot already held by the viewer."),
  }),
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  maxResultChars: 1_052_000,
  run: async ({ designId, fileId, knownUpdatedAt }) => {
    await assertAccess("design", designId, "viewer");

    const db = getDb();
    const table = schema.designVisualEditSnapshots;
    const where = and(eq(table.designId, designId), eq(table.fileId, fileId));
    const [latest] = await db
      .select({
        updatedAt: table.updatedAt,
      })
      .from(table)
      .where(where)
      .limit(1);

    if (!latest) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: null,
        unchanged: false,
      };
    }
    if (knownUpdatedAt && latest.updatedAt === knownUpdatedAt) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: latest.updatedAt,
        unchanged: true,
      };
    }

    const [snapshot] = await db
      .select({
        html: table.html,
        blobHandle: table.blobHandle,
        updatedAt: table.updatedAt,
      })
      .from(table)
      .where(where)
      .limit(1);
    const hasSnapshot = Boolean(snapshot?.blobHandle || snapshot?.html);
    if (!hasSnapshot || !snapshot) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: null,
        unchanged: false,
      };
    }
    if (snapshot.updatedAt === knownUpdatedAt) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: snapshot.updatedAt,
        unchanged: true,
      };
    }

    let html: string;
    if (snapshot.blobHandle) {
      const blob = await readPrivateBlob(
        parsePrivateBlobHandle(snapshot.blobHandle),
      );
      if (blob.data.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
      }
      html = new TextDecoder("utf-8", { fatal: true }).decode(blob.data);
    } else {
      // Existing pre-blob rows stay readable until an owner publishes their next snapshot.
      html = snapshot.html;
      if (new TextEncoder().encode(html).byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
      }
    }

    return {
      designId,
      fileId,
      html,
      updatedAt: snapshot.updatedAt,
      unchanged: false,
    };
  },
});
