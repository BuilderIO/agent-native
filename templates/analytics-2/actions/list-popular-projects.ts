import { defineAction } from "@agent-native/core/action";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfilesWithStatus } from "@agent-native/core/user-profile/server";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import {
  POPULAR_WINDOW_DAYS,
  listPopularProjects,
} from "../server/model/project-views.js";

const WINDOWS = {
  oneDay: 1,
  oneWeek: POPULAR_WINDOW_DAYS,
  oneMonth: 30,
} as const;

export default defineAction({
  description:
    "List accessible published projects ranked by recorded app views in the selected time window. Unclassified historical opens are excluded.",
  schema: z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(6),
      offset: z.coerce.number().int().min(0).default(0),
      viewCountDuration: z
        .enum(["oneDay", "oneWeek", "oneMonth"])
        .default("oneWeek"),
    })
    .strict(),
  outputSchema: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        allowEmbedding: z.boolean(),
        viewCount: z.number().int().min(0),
        lastViewedAt: z.string().nullable(),
        ownerName: z.string().nullable(),
        creatorName: z.string().nullable(),
        createdAt: z.string(),
        lastEditedAt: z.string(),
        namesUnavailable: z.boolean(),
      }),
    ),
    hasMore: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ limit, offset, viewCountDuration }) => {
    const current = await requireCurrentWorkspace();
    const projects = await listPopularProjects(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      { limit: limit + 1, offset, windowDays: WINDOWS[viewCountDuration] },
    );
    const visible = projects.slice(0, limit);
    const emails = visible.flatMap((row) => [
      row.ownerEmail,
      ...(row.creatorEmail ? [row.creatorEmail] : []),
    ]);
    const { profiles, incomplete } = await getUserProfilesWithStatus(emails);
    const displayName = (email: string | null) => {
      if (!email) return null;
      const name = profiles.get(email.toLowerCase())?.name.trim();
      return name && !isEmailDerivedName(name, email) ? name : null;
    };
    return {
      projects: visible.map(({ ownerEmail, creatorEmail, ...row }) => ({
        ...row,
        ownerName: displayName(ownerEmail),
        creatorName: displayName(creatorEmail),
        namesUnavailable: incomplete,
      })),
      hasMore: projects.length > limit,
    };
  },
});
