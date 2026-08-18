import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCreativeContext } from "../server/context.js";
import {
  parseNativeCreativeArtifactKey,
  resolveNativeCreativeResourceUpdateStatuses,
} from "../server/native-resource-capture.js";
import { listContextMemberships } from "../store/index.js";

export default defineAction({
  description:
    "List published memberships in a governed Creative Context. Pending submissions are visible only to their submitter and reviewers.",
  schema: z.object({
    contextId: z.string().min(1),
    status: z.enum(["active", "removed"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const result = await listContextMemberships(args);
    const activeAppId = getCreativeContext().connectorContext.appId;
    const references = result.memberships.flatMap((membership: any) => {
      const reference = parseNativeCreativeArtifactKey(membership.artifactKey);
      if (
        !reference ||
        reference.appId !== activeAppId ||
        !membership.publishedItem
      ) {
        return [];
      }
      return [
        {
          key: membership.id,
          ...reference,
          publishedSourceModifiedAt:
            membership.publishedItem.sourceModifiedAt ?? null,
        },
      ];
    });
    const statuses =
      await resolveNativeCreativeResourceUpdateStatuses(references);
    return {
      ...result,
      memberships: result.memberships.map((membership: any) => {
        const status = statuses.get(membership.id);
        return status
          ? { ...membership, nativeUpdateStatus: { state: status.state } }
          : membership;
      }),
    };
  },
});
