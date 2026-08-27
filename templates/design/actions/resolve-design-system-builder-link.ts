import { defineAction } from "@agent-native/core/action";
import {
  builderProjectBranchUrl,
  fetchBuilderDesignSystemRecord,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

function canManageRole(role: string): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

export default defineAction({
  description:
    "Resolve the Builder project/branch interactive preview URL for a " +
    "Builder-backed design system. Only calls out to Builder when the " +
    "project id or branch id is not already cached locally; the persisted " +
    "builderUrl otherwise falls back to the Builder design-system docs page " +
    "instead of the live project/branch preview.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  run: async ({ id }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) throw new Error("Design system not found");

    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(access.resource.data);
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new Error();
      }
      parsed = json as Record<string, unknown>;
    } catch {
      throw new Error("Design system data is invalid");
    }

    if (parsed.source !== "builder") {
      throw new Error("This design system is not Builder-backed.");
    }
    const builderDesignSystemId = parsed.builderDesignSystemId;
    if (typeof builderDesignSystemId !== "string") {
      throw new Error("Missing Builder design system id.");
    }

    const cachedProjectId =
      typeof parsed.builderProjectId === "string"
        ? parsed.builderProjectId
        : undefined;
    const cachedBranchName =
      typeof parsed.builderBranchName === "string"
        ? parsed.builderBranchName
        : undefined;

    if (cachedProjectId && cachedBranchName) {
      return {
        builderUrl: builderProjectBranchUrl(cachedProjectId, cachedBranchName),
      };
    }

    const record = await fetchBuilderDesignSystemRecord(builderDesignSystemId);
    const projectId = record?.projectId ?? cachedProjectId;
    const branchName = record?.branchName ?? cachedBranchName;
    const builderUrl = builderProjectBranchUrl(projectId, branchName) ?? null;

    if (
      builderUrl &&
      canManageRole(access.role) &&
      (projectId !== cachedProjectId || branchName !== cachedBranchName)
    ) {
      const db = getDb();
      await db
        .update(schema.designSystems)
        .set({
          data: JSON.stringify({
            ...parsed,
            builderProjectId: projectId,
            builderBranchName: branchName,
            builderUrl,
          }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.designSystems.id, id));
    }

    return { builderUrl };
  },
});
