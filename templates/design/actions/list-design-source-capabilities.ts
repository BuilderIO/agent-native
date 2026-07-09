import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import { DESIGN_CAPABILITY_NAMES } from "../shared/design-source-capabilities.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  designConnectionIdFromData,
  designSourceTypeFromData,
} from "../shared/source-mode.js";

export default defineAction({
  description:
    "Return the capability matrix for a design's current source. " +
    "The matrix maps each capability name (readFile, writeFile, applyEdit, " +
    "resolveNodeToFile, previewPatch, diffPatch, captureSnapshot, captureState, " +
    "indexComponents, indexTokens, writeTokens, previewMotion, writeMotion, " +
    "branch, deployPreview, deploy) to its status (available | planned | " +
    "unavailable) plus an optional human-readable reason. " +
    "UI controls and agent actions must gate on this matrix — never on sourceType alone.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID to fetch source capabilities for"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const db = getDb();

    // Resolve source type from the design's data blob.  The `sourceType`
    // field lives inside `designs.data` as a JSON key (set by connect-localhost
    // and the fusion upgrade flow), falling back to "inline" when absent.
    const rawData = (access.resource as { data?: unknown }).data;
    const sourceType = designSourceTypeFromData(rawData);
    const capabilities = resolveSourceCapabilities(sourceType);

    // Collect active localhost capabilities from the design's stored connection,
    // if any, so that a bridge handshake that has already proven readFile
    // is reflected here too.
    let connectionCapabilities: Record<string, { status: string }> = {};
    if (sourceType === "localhost") {
      try {
        const rawDesignData =
          typeof rawData === "string" ? JSON.parse(rawData) : {};
        const connectionId = designConnectionIdFromData(rawDesignData);

        const ownerEmail = getRequestUserEmail();
        const orgId = getRequestOrgId() ?? null;
        if (connectionId && ownerEmail) {
          const [conn] = await db
            .select({
              capabilities: schema.designLocalhostConnections.capabilities,
            })
            .from(schema.designLocalhostConnections)
            .where(
              and(
                eq(schema.designLocalhostConnections.id, connectionId),
                eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
                orgId
                  ? eq(schema.designLocalhostConnections.orgId, orgId)
                  : isNull(schema.designLocalhostConnections.orgId),
              ),
            )
            .limit(1);

          if (conn?.capabilities) {
            try {
              const parsed: unknown = JSON.parse(conn.capabilities);
              if (Array.isArray(parsed)) {
                // Bridge capabilities are DesignBridgeCapability[] with operation + status.
                for (const entry of parsed) {
                  if (
                    entry !== null &&
                    typeof entry === "object" &&
                    "operation" in entry &&
                    "status" in entry
                  ) {
                    const op = String(
                      (entry as { operation: unknown }).operation,
                    );
                    const st = String((entry as { status: unknown }).status);
                    connectionCapabilities[op] = { status: st };
                  }
                }
              }
            } catch {
              // Ignore stale/invalid capability JSON.
            }
          }
        }
      } catch {
        // Non-fatal: fall back to the defaults.
      }
    }

    // Merge proven bridge capabilities (only for capabilities that exist in
    // DESIGN_CAPABILITY_NAMES and only when the bridge reports "available").
    const merged = { ...capabilities };
    for (const capName of DESIGN_CAPABILITY_NAMES) {
      const bridgeEntry = connectionCapabilities[capName];
      if (bridgeEntry?.status === "available") {
        merged[capName] = { status: "available" };
      }
    }

    // Flatten to a list for easy agent consumption.
    const capabilityList = DESIGN_CAPABILITY_NAMES.map((name) => ({
      name,
      ...merged[name],
    }));

    const availableNames = capabilityList
      .filter((c) => c.status === "available")
      .map((c) => c.name);

    return {
      designId,
      sourceType,
      capabilities: capabilityList,
      availableCapabilities: availableNames,
      summary: {
        canWrite:
          merged.applyEdit.status === "available" ||
          merged.writeFile.status === "available",
        canIndexComponents: merged.indexComponents.status === "available",
        canWriteTokens: merged.writeTokens.status === "available",
        canMotion:
          merged.previewMotion.status === "available" ||
          merged.writeMotion.status === "available",
        canBranch: merged.branch.status === "available",
        canDeploy: merged.deploy.status === "available",
      },
    };
  },
});
