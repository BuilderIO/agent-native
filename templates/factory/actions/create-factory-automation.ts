import { defineAction, fail } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import {
  VaultUnavailableError,
  assertFactoryConnectorReady,
} from "../server/connectors/credentials.js";
import { readFactoryDefinition } from "../server/factory-graph/store.js";
import {
  FACTORY_INBOX_LIMIT_MAX,
  FACTORY_WORK_LIMIT_MAX,
  assertAuthorFilter,
  clampInboxLimit,
  clampWorkLimit,
  defaultAutomationConfig,
  sourceForTemplate,
  type FactoryAutomationConfig,
} from "../server/lib/factory-automation-config.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import {
  createFactoryAutomation,
  factoryAutomationTemplatePrompt,
} from "../server/plugins/factory-scheduler-job.js";

const sourceSchema = z.enum(["slack", "github", "sentry"]);
const templateSchema = z.enum([
  "blank",
  "slack-feedback",
  "github-issues",
  "pr-governance",
  "pr-babysit",
  "sentry-errors",
]);

export default defineAction({
  description:
    "Create one Slack, GitHub, or Sentry job on an existing Factory. Use this when the user asks to create an automation. Do not save a graph or rename the factory. Ask for a Slack channel id, GitHub repository, or Sentry slugs if missing. Opens the Automations tab. Reply with the job name and source, not pipeline stages. Hosted jobs need a workspace connection or vault token. Pass author ids (Slack U/W or GitHub numeric ids), not names. Limits are action-enforced.",
  schema: z.object({
    factoryId: factoryIdSchema,
    displayName: z.string().trim().min(1).max(120),
    source: sourceSchema,
    template: templateSchema.default("blank"),
    slackWorkspace: z.enum(["primary", "secondary"]).optional(),
    slackChannelId: z.string().trim().max(128).optional(),
    slackChannelName: z.string().trim().max(200).optional(),
    repository: z.string().trim().max(512).optional(),
    sentryOrgSlug: z.string().trim().max(200).optional(),
    sentryProjectSlug: z.string().trim().max(200).optional(),
    sentryEnvironment: z.string().trim().max(200).optional(),
    authorMode: z.enum(["include", "exclude"]).default("exclude"),
    authorIds: z.array(z.string().trim().min(1).max(32)).max(50).default([]),
    scheduleMode: z.enum(["interval", "daily"]).default("interval"),
    intervalMinutes: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .default(5),
    dailyHour: z.number().int().min(0).max(23).default(9),
    dailyMinute: z.number().int().min(0).max(59).default(0),
    timezone: z.string().trim().max(80).optional(),
    inboxLimit: z.number().int().min(1).max(FACTORY_INBOX_LIMIT_MAX).optional(),
    workLimit: z.number().int().min(1).max(FACTORY_WORK_LIMIT_MAX).optional(),
    prompt: z.string().trim().max(20_000).optional(),
    enabled: z.boolean().default(false),
  }),
  http: { method: "POST" },
  link: ({ result }) => ({
    url: buildDeepLink({
      app: "factory",
      view: "factory",
      params: {
        factoryId: result.factoryId,
        tab: "automations",
        automationId: result.id,
      },
      to: `/factory?factoryId=${encodeURIComponent(result.factoryId)}&tab=automations&automationId=${encodeURIComponent(result.id)}`,
    }),
    label: `Open ${result.displayName} in Factory`,
  }),
  run: async (input, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const factory = await readFactoryDefinition(orgId, input.factoryId);
    if (!factory) fail("Factory not found.", { statusCode: 404 });
    const templateSource = sourceForTemplate(input.template);
    if (templateSource && templateSource !== input.source) {
      fail("Template does not match the selected source.");
    }
    let authorIds: string[];
    try {
      authorIds = assertAuthorFilter(
        input.source,
        input.authorMode ?? "exclude",
        input.source === "sentry" ? [] : (input.authorIds ?? []),
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Invalid author filter.");
    }
    if (input.source === "slack" && !input.slackChannelId?.trim()) {
      fail("Configure a Slack channel before creating this job.");
    }
    if (input.source === "github" && !input.repository?.trim()) {
      fail("Configure a GitHub repository before creating this job.");
    }
    if (
      input.source === "sentry" &&
      (!input.sentryOrgSlug?.trim() || !input.sentryProjectSlug?.trim())
    ) {
      fail(
        "Configure Sentry organization and project slugs before creating this job.",
      );
    }
    if (input.scheduleMode === "daily" && !input.timezone?.trim()) {
      fail("Choose a timezone for a daily schedule.");
    }
    if (input.enabled) {
      try {
        await assertFactoryConnectorReady(input.source, userEmail, {
          orgId,
          slackWorkspace:
            input.slackWorkspace === "secondary" ? "secondary" : "primary",
          verb: "creating",
        });
      } catch (error) {
        if (error instanceof VaultUnavailableError) fail(error.message);
        fail(
          error instanceof Error ? error.message : "Connector is not ready.",
        );
      }
    }
    const defaults = defaultAutomationConfig(input.source, input.template);
    const config: FactoryAutomationConfig = {
      ...defaults,
      slackWorkspace:
        input.slackWorkspace === "secondary" ? "secondary" : "primary",
      slackChannelId: input.slackChannelId?.trim() || null,
      slackChannelName: input.slackChannelName?.trim() || null,
      repository: input.repository?.trim() || null,
      sentryOrgSlug: input.sentryOrgSlug?.trim() || null,
      sentryProjectSlug: input.sentryProjectSlug?.trim() || null,
      sentryEnvironment: input.sentryEnvironment?.trim() || null,
      authorMode: input.authorMode ?? defaults.authorMode,
      authorIds,
      scheduleMode: input.scheduleMode ?? defaults.scheduleMode,
      intervalMinutes: input.intervalMinutes ?? defaults.intervalMinutes,
      dailyHour: input.dailyHour ?? defaults.dailyHour,
      dailyMinute: input.dailyMinute ?? defaults.dailyMinute,
      timezone:
        (input.scheduleMode ?? defaults.scheduleMode) === "daily"
          ? input.timezone?.trim() || defaults.timezone
          : null,
      inboxLimit: clampInboxLimit(input.inboxLimit ?? defaults.inboxLimit),
      workLimit: clampWorkLimit(
        input.workLimit ?? defaults.workLimit,
        input.source,
      ),
    };
    const prompt =
      input.prompt?.trim() ||
      factoryAutomationTemplatePrompt(input.template, input.source);
    const created = await createFactoryAutomation(
      userEmail,
      orgId,
      input.factoryId,
      {
        displayName: input.displayName,
        prompt,
        config,
        enabled: input.enabled,
      },
    );
    if (
      context?.caller === "tool" ||
      context?.caller === "mcp" ||
      context?.caller === "a2a"
    ) {
      await writeAppStateForCurrentTab("navigate", {
        view: "factory",
        path: `/factory?factoryId=${encodeURIComponent(input.factoryId)}&tab=automations&automationId=${encodeURIComponent(created.id)}`,
        _writeId: `${Date.now()}-create-factory-automation`,
      });
    }
    return {
      ok: true,
      factoryId: input.factoryId,
      id: created.id,
      name: created.name,
      path: created.path,
      displayName: input.displayName,
      source: config.source,
      inboxLimit: config.inboxLimit,
      workLimit: config.workLimit,
    };
  },
});
