import { defineAction } from "@agent-native/core/action";
import { getEmailReadiness } from "@agent-native/core/server";
import { z } from "zod";

import { resolveFactoryConnectorReadiness } from "../server/connectors/credentials.js";
import { getDb } from "../server/db/index.js";
import { DEFAULT_FACTORY_ID } from "../server/lib/factory-ids.js";
import {
  factoryIdSchema,
  readTriageConfigRow,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  SECRET_UNREADABLE_CODE,
  isUnreadableSecret,
} from "../server/lib/unreadable-secret.js";

export default defineAction({
  description:
    "Read Factory observation settings for the selected factory. Secret values are never returned. A connector outage is returned as readinessError and does not drop inbox or observation settings; readinessErrorCode is app_secret_unreadable when a saved key cannot be decrypted here, which a person must fix and no retry heals.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const emailReadiness = await getEmailReadiness();
    const row = await readTriageConfigRow(getDb(), orgId, factoryId);
    let connections:
      | Awaited<ReturnType<typeof resolveFactoryConnectorReadiness>>
      | undefined;
    let readinessError: string | undefined;
    let readinessErrorCode: string | undefined;
    try {
      connections = await resolveFactoryConnectorReadiness(userEmail, {
        orgId,
      });
    } catch (error) {
      readinessError =
        error instanceof Error
          ? error.message
          : "Connector readiness is unavailable.";
      // Saved but undecryptable is a fix for a person, not an outage to wait out.
      if (isUnreadableSecret(error))
        readinessErrorCode = SECRET_UNREADABLE_CODE;
    }
    const readiness = connections
      ? { connections }
      : {
          readinessError:
            readinessError ?? "Connector readiness is unavailable.",
          ...(readinessErrorCode ? { readinessErrorCode } : {}),
        };
    if (!row) {
      return {
        factoryId,
        slackWorkspace: "primary",
        slackChannelId: null,
        slackChannelName: null,
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
        ...readiness,
      };
    }
    const { builderSlackUserId: _builderSlackUserId, ...storedRow } = row;
    return {
      ...storedRow,
      factoryId,
      pollingEnabled: row.pollingEnabled === 1,
      githubPollingEnabled: row.githubPollingEnabled === 1,
      sentryPollingEnabled: row.sentryPollingEnabled === 1,
      automationFailureAlertsEnabled: row.automationFailureAlertsEnabled === 1,
      automationFailureAlertEmail: row.automationFailureAlertEmail,
      emailReadiness,
      ...readiness,
    };
  },
});
