import { defineAction, fail } from "@agent-native/core/action";
import {
  parseBuilderDesignSystemProxyReference,
  startBuilderDesignSystemIndex,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async ({ id }) => {
    await assertAccess("design-system", id, "editor");
    const access = await resolveAccess("design-system", id);
    if (!access) {
      fail("Design system not found", {
        errorCode: "design_system_not_found",
        statusCode: 404,
      });
    }

    const reference = parseBuilderDesignSystemProxyReference(
      access.resource.data,
    );
    if (!reference?.githubSources?.length) {
      fail("This design system has no persisted GitHub source scope to sync.", {
        errorCode: "design_system_source_scope_missing",
        statusCode: 409,
      });
    }
    if (reference.sourceKind === "mixed") {
      fail(
        "This design system combines GitHub with non-replayable sources. Re-import all sources before syncing it.",
        {
          errorCode: "design_system_mixed_sources_not_syncable",
          statusCode: 409,
        },
      );
    }

    const result = await startBuilderDesignSystemIndex({
      projectName: access.resource.title,
      description: access.resource.description ?? undefined,
      githubRepos: reference.githubSources,
    });
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }

    const proxy = await upsertBuilderProxyDesignSystem({
      result,
      ownerEmail: access.resource.ownerEmail,
      orgId: access.resource.orgId,
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
