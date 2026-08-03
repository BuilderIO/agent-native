import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Read Factory observation settings for the active workspace. Secret values are never returned.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const row = (
      await getDb()
        .select()
        .from(triageConfig)
        .where(eq(triageConfig.id, orgId))
        .limit(1)
    )[0];
    if (!row) {
      return {
        slackWorkspace: "primary",
        slackChannelId: null,
        slackChannelName: null,
        pollingEnabled: false,
        lastSlackTs: null,
        slackHistoryCursor: null,
        repository: null,
      };
    }
    return { ...row, pollingEnabled: row.pollingEnabled === 1 };
  },
});
