import { defineAction } from "@agent-native/core";
import {
  parseBuilderDesignSystemProxyReference,
  startBuilderDesignSystemIndex,
} from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { upsertBuilderProxyDesignSystem } from "../server/lib/builder-design-system-proxy.js";

export default defineAction({
  description:
    "Re-index a Builder-backed GitHub design system using its persisted repository, ref, and file/folder scope. Requires editor access.",
  schema: z.object({
    id: z.string().min(1).describe("Local design system id"),
  }),
  run: async ({ id }) => {
    await assertAccess("design-system", id, "editor");
    const access = await resolveAccess("design-system", id);
    if (!access) throw new Error("Design system not found");

    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference?.githubSources?.length) {
      throw new Error(
        "This design system has no persisted GitHub source scope to sync.",
      );
    }
    if (reference.sourceKind === "mixed") {
      throw new Error(
        "This design system combines GitHub with non-replayable sources. Re-import all sources before syncing it.",
      );
    }

    const result = await startBuilderDesignSystemIndex({
      projectName: access.resource.title,
      description: access.resource.description ?? undefined,
      githubRepos: reference.githubSources,
    });
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const proxy = await upsertBuilderProxyDesignSystem({
      result,
      ownerEmail,
      orgId: getRequestOrgId(),
      projectName: access.resource.title,
      description: access.resource.description ?? undefined,
      sourceKind: reference.sourceKind,
      githubSources: reference.githubSources,
      localDesignSystemId: id,
    });

    return {
      ...result,
      ...proxy,
      synced: true,
      githubSourceCount: reference.githubSources.length,
    };
  },
});
