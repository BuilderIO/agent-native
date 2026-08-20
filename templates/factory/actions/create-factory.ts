import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
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
  assertUniqueSlackChannelForFactory,
  factoryConfigRowId,
  resolveUniqueFactoryId,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  ensureFactoryAutomations,
  syncFactoryAutomationEnabledStates,
} from "../server/plugins/factory-scheduler-job.js";
import { stableId } from "../server/triage/ids.js";

const PR_AUTOMATIONS = ["factory-pr-governance", "factory-pr-babysit"] as const;

function resolveEnabledAutomations(input: {
  observeSlack: boolean;
  slackChannelId?: string;
  observeGithub: boolean;
  repository?: string;
  observeSentry: boolean;
  sentryOrgSlug?: string;
  sentryProjectSlug?: string;
}): {
  enabledNames: Set<string>;
  pollingEnabled: boolean;
  githubPollingEnabled: boolean;
  sentryPollingEnabled: boolean;
  hasConfig: boolean;
} {
  const enabledNames = new Set<string>();
  let pollingEnabled = false;
  let githubPollingEnabled = false;
  let sentryPollingEnabled = false;
  let hasConfig = false;

  if (input.observeSlack) {
    if (!input.slackChannelId?.trim()) {
      throw new Error(
        "Configure a Slack channel before enabling Slack observation.",
      );
    }
    enabledNames.add("factory-slack-feedback");
    pollingEnabled = true;
    hasConfig = true;
  }

  if (input.observeGithub) {
    if (!input.repository?.trim()) {
      throw new Error(
        "Configure a GitHub repository before enabling GitHub observation.",
      );
    }
    enabledNames.add("factory-github-issues");
    githubPollingEnabled = true;
    hasConfig = true;
  }

  if (input.repository?.trim()) {
    for (const name of PR_AUTOMATIONS) enabledNames.add(name);
    hasConfig = true;
  }

  if (input.observeSentry) {
    if (!input.sentryOrgSlug?.trim() || !input.sentryProjectSlug?.trim()) {
      throw new Error(
        "Configure Sentry organization and project slugs before enabling Sentry observation.",
      );
    }
    enabledNames.add("factory-sentry-errors");
    sentryPollingEnabled = true;
    hasConfig = true;
  }

  return {
    enabledNames,
    pollingEnabled,
    githubPollingEnabled,
    sentryPollingEnabled,
    hasConfig,
  };
}

export default defineAction({
  description:
    "Create a new Factory with a minimal blueprint, optional observation settings, and seeded automations. Name is required; sources and automations are optional.",
  schema: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
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
    const factoryId = await resolveUniqueFactoryId(db, orgId, input.name);
    const description = input.description?.trim() ?? "";
    const graph = normalizeFactoryGraph(
      minimalFactoryGraph(input.name, description),
    );
    const now = new Date().toISOString();
    const versionId = stableId("factory-graph", orgId, factoryId, "1");
    const automationPlan = resolveEnabledAutomations({
      observeSlack: input.observeSlack === true,
      slackChannelId: input.slackChannelId,
      observeGithub: input.observeGithub === true,
      repository: input.repository,
      observeSentry: input.observeSentry === true,
      sentryOrgSlug: input.sentryOrgSlug,
      sentryProjectSlug: input.sentryProjectSlug,
    });

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

      if (automationPlan.hasConfig) {
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
          slackWorkspace: "primary",
          slackChannelId,
          slackChannelName: input.slackChannelName?.trim() || null,
          builderSlackUserId: null,
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

    await ensureFactoryAutomations(userEmail, orgId, factoryId, {
      enabledNames: automationPlan.enabledNames,
    });
    if (automationPlan.enabledNames.size > 0) {
      await syncFactoryAutomationEnabledStates(userEmail, orgId, factoryId, [
        ...automationPlan.enabledNames,
      ]);
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
