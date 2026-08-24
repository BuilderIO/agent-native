import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryDefinitions,
  factoryGraphVersions,
  triageConfig,
} from "../server/db/schema.js";
import {
  minimalFactoryGraph,
  normalizeFactoryGraph,
} from "../server/factory-graph/contracts.js";
import {
  resolveEnabledAutomations,
  isFactoryIdConflict,
  isFactorySlackChannelConflict,
} from "../server/lib/factory-automation-plan.js";
import {
  assertUniqueSlackChannelForFactory,
  builderSlackUserIdSchema,
  factoryConfigRowId,
  resolveUniqueFactoryId,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  ensureFactoryAutomations,
  removeFactoryAutomationResources,
  syncFactoryAutomationEnabledStates,
} from "../server/plugins/factory-scheduler-job.js";
import { stableId } from "../server/triage/ids.js";

export default defineAction({
  description:
    "Create a new Factory with a minimal blueprint, optional observation settings, and seeded automations. Name is required; sources and automations are optional.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    slackWorkspace: z.enum(["primary", "secondary"]).optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    builderSlackUserId: builderSlackUserIdSchema.optional(),
    observeSlack: z.boolean().optional(),
    repository: z.string().trim().max(256).optional(),
    observeGithub: z.boolean().optional(),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    observeSentry: z.boolean().optional(),
  }),
  http: { method: "POST" },
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "factory",
      view: "factory",
      params: { factoryId: result.factoryId },
    }),
    label: `Open ${result.name} in Factory`,
  }),
  run: async (input, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const description = input.description?.trim() ?? "";
    const graph = normalizeFactoryGraph(
      minimalFactoryGraph(input.name, description),
    );
    const now = new Date().toISOString();
    const automationPlan = resolveEnabledAutomations({
      observeSlack: input.observeSlack === true,
      slackChannelId: input.slackChannelId,
      observeGithub: input.observeGithub === true,
      repository: input.repository,
      observeSentry: input.observeSentry === true,
      sentryOrgSlug: input.sentryOrgSlug,
      sentryProjectSlug: input.sentryProjectSlug,
    });

    const MAX_FACTORY_CREATE_ATTEMPTS = 5;
    let factoryId = "";
    for (let attempt = 0; attempt < MAX_FACTORY_CREATE_ATTEMPTS; attempt++) {
      factoryId = await resolveUniqueFactoryId(db, orgId, input.name);
      const versionId = stableId("factory-graph", orgId, factoryId, "1");
      try {
        await db.transaction(async (tx) => {
          await tx.insert(factoryDefinitions).values({
            id: factoryId,
            name: input.name,
            description,
            prompt: "",
            graphVersion: 1,
            graphJson: JSON.stringify(graph),
            createdAt: now,
            updatedAt: now,
            ownerEmail: userEmail,
            orgId,
          });
          await tx.insert(factoryGraphVersions).values({
            id: versionId,
            factoryId,
            version: 1,
            graphJson: JSON.stringify(graph),
            source: "manual",
            changeSummary: "Created from the new factory dialog.",
            createdAt: now,
            createdBy: userEmail,
            ownerEmail: userEmail,
            orgId,
          });

          const shouldWriteConfig =
            automationPlan.hasConfig ||
            Boolean(input.slackChannelId?.trim()) ||
            Boolean(input.slackChannelName?.trim()) ||
            Boolean(input.builderSlackUserId?.trim()) ||
            Boolean(input.slackWorkspace) ||
            Boolean(input.sentryOrgSlug?.trim()) ||
            Boolean(input.sentryProjectSlug?.trim()) ||
            Boolean(input.sentryEnvironment?.trim());
          if (shouldWriteConfig) {
            const slackChannelId = input.slackChannelId?.trim() || null;
            await assertUniqueSlackChannelForFactory(
              tx as unknown as typeof db,
              orgId,
              factoryId,
              slackChannelId,
            );
            await tx.insert(triageConfig).values({
              id: factoryConfigRowId(orgId, factoryId),
              factoryId,
              slackWorkspace:
                input.slackWorkspace === "secondary" ? "secondary" : "primary",
              slackChannelId,
              slackChannelName: input.slackChannelName?.trim() || null,
              builderSlackUserId: input.builderSlackUserId?.trim() || null,
              pollingEnabled: automationPlan.pollingEnabled ? 1 : 0,
              githubPollingEnabled: automationPlan.githubPollingEnabled ? 1 : 0,
              sentryPollingEnabled: automationPlan.sentryPollingEnabled ? 1 : 0,
              sentryOrgSlug: input.sentryOrgSlug?.trim() || null,
              sentryProjectSlug: input.sentryProjectSlug?.trim() || null,
              sentryEnvironment: input.sentryEnvironment?.trim() || null,
              repository: input.repository?.trim() || null,
              automationFailureAlertsEnabled: 1,
              automationFailureAlertEmail: null,
              createdAt: now,
              updatedAt: now,
              ownerEmail: userEmail,
              orgId,
            });
          }
        });
        break;
      } catch (error) {
        if (isFactorySlackChannelConflict(error)) {
          throw new Error(
            "That Slack channel is already used by another Factory in this workspace.",
          );
        }
        if (
          isFactoryIdConflict(error) &&
          attempt < MAX_FACTORY_CREATE_ATTEMPTS - 1
        ) {
          continue;
        }
        throw error;
      }
    }
    if (!factoryId) {
      throw new Error("Could not allocate a unique factory id.");
    }

    try {
      await ensureFactoryAutomations(userEmail, orgId, factoryId, {
        enabledNames: automationPlan.enabledNames,
      });
      if (automationPlan.enabledNames.size > 0) {
        await syncFactoryAutomationEnabledStates(userEmail, orgId, factoryId, [
          ...automationPlan.enabledNames,
        ]);
      }
    } catch (error) {
      await removeFactoryAutomationResources(orgId, factoryId);
      await db
        .delete(triageConfig)
        .where(
          and(
            eq(triageConfig.orgId, orgId),
            eq(triageConfig.factoryId, factoryId),
          ),
        );
      await db
        .delete(factoryGraphVersions)
        .where(
          and(
            eq(factoryGraphVersions.orgId, orgId),
            eq(factoryGraphVersions.factoryId, factoryId),
          ),
        );
      await db
        .delete(factoryDefinitions)
        .where(
          and(
            eq(factoryDefinitions.id, factoryId),
            eq(factoryDefinitions.orgId, orgId),
          ),
        );
      throw error;
    }

    return {
      ok: true,
      factoryId,
      name: input.name,
      graphVersion: 1,
      enabledAutomations: [...automationPlan.enabledNames],
    };
  },
});
