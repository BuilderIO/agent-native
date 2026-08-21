import { defineAction } from "@agent-native/core/action";
import { getEmailReadiness } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  readTriageConfigRow,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Read Factory observation settings for the selected factory. Secret values are never returned.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const emailReadiness = await getEmailReadiness();
    const row = await readTriageConfigRow(getDb(), orgId, factoryId);
    if (!row) {
      return {
        factoryId,
        slackWorkspace: "primary",
        slackChannelId: null,
        slackChannelName: null,
        builderSlackUserId: null,
        pollingEnabled: false,
        lastSlackTs: null,
        slackHistoryCursor: null,
        repository: null,
        githubPollingEnabled: false,
        sentryPollingEnabled: false,
        sentryOrgSlug: null,
        sentryProjectSlug: null,
        sentryEnvironment: null,
        lastSentrySeenAt: null,
        automationFailureAlertsEnabled: true,
        automationFailureAlertEmail: null,
        emailReadiness,
      };
    }
    return {
      ...row,
      factoryId,
      pollingEnabled: row.pollingEnabled === 1,
      githubPollingEnabled: row.githubPollingEnabled === 1,
      sentryPollingEnabled: row.sentryPollingEnabled === 1,
      automationFailureAlertsEnabled: row.automationFailureAlertsEnabled === 1,
      automationFailureAlertEmail: row.automationFailureAlertEmail,
      emailReadiness,
    };
  },
});
