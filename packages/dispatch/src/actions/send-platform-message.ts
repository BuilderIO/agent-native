import { defineAction } from "@agent-native/core";
import {
  listIntegrationInstallations,
  resolveIntegrationTokenBundle,
} from "@agent-native/core/integrations";
import {
  getRequestOrgId,
  getRequestUserEmail,
  slackAdapter,
  telegramAdapter,
  emailAdapter,
  isEmailConfigured,
  resolveSecret,
} from "@agent-native/core/server";
import { z } from "zod";

import { getDestinationById } from "../server/lib/dispatch-store.js";

function getAdapter(
  platform: "slack" | "telegram" | "email",
  slackToken?: string,
) {
  if (platform === "email") return emailAdapter();
  return platform === "slack"
    ? slackAdapter({ resolveBotToken: async () => slackToken })
    : telegramAdapter();
}

async function assertOutboundConfigured(
  platform: "slack" | "telegram" | "email",
  tenantId?: string,
): Promise<string | undefined> {
  if (platform === "slack") {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("An authenticated user is required");
    const installations = tenantId
      ? await listIntegrationInstallations(
          { userEmail, orgId: getRequestOrgId() ?? null },
          "slack",
        )
      : [];
    const installation =
      installations.find(
        (candidate) =>
          candidate.teamId === tenantId || candidate.enterpriseId === tenantId,
      ) ?? null;
    const managed = installation
      ? await resolveIntegrationTokenBundle(
          "slack",
          installation.installationKey,
        )
      : null;
    const token =
      managed?.accessToken ?? (await resolveSecret("SLACK_BOT_TOKEN"));
    if (!token) {
      throw new Error(
        tenantId
          ? "That Slack workspace is not connected"
          : "Select a Slack workspace for managed outbound messaging",
      );
    }
    return token;
  }
  if (platform === "telegram" && !(await resolveSecret("TELEGRAM_BOT_TOKEN"))) {
    throw new Error("Telegram outbound messaging is not configured");
  }
  if (platform === "email") {
    if (
      !(await resolveSecret("EMAIL_AGENT_ADDRESS")) ||
      !(await isEmailConfigured())
    ) {
      throw new Error("Email outbound messaging is not configured");
    }
  }
}

export default defineAction({
  description:
    "Send a proactive message to a saved Slack, Telegram, or email destination.",
  schema: z.object({
    platform: z.enum(["slack", "telegram", "email"]).optional(),
    destinationId: z.string().optional().describe("Saved destination id"),
    destination: z.string().optional().describe("Raw platform destination id"),
    threadRef: z.string().optional().describe("Optional thread reference"),
    tenantId: z
      .string()
      .optional()
      .describe("Slack workspace/team id for managed installations"),
    text: z.string().describe("Message to send"),
  }),
  audit: {
    recordInputs: false,
    target: (args) => ({
      type: "destination",
      id: args.destinationId || args.destination || "unknown",
      visibility: "private",
    }),
    summary: (args) => `Sent proactive ${args.platform || "saved"} message`,
  },
  run: async ({
    platform,
    destinationId,
    destination,
    threadRef,
    tenantId,
    text,
  }) => {
    const saved = destinationId
      ? await getDestinationById(destinationId)
      : null;
    const resolvedPlatform = (saved?.platform || platform) as
      | "slack"
      | "telegram"
      | "email"
      | undefined;
    const resolvedDestination = saved?.destination || destination;
    const resolvedThreadRef = saved?.threadRef || threadRef || null;

    if (!resolvedPlatform || !resolvedDestination) {
      throw new Error("A platform and destination are required");
    }

    const slackToken = await assertOutboundConfigured(
      resolvedPlatform,
      tenantId,
    );

    const adapter = getAdapter(resolvedPlatform, slackToken);
    if (!adapter.sendMessageToTarget) {
      throw new Error(
        `Platform ${resolvedPlatform} does not support proactive outbound messaging`,
      );
    }

    await adapter.sendMessageToTarget(adapter.formatAgentResponse(text), {
      destination: resolvedDestination,
      threadRef: resolvedThreadRef,
      label: saved?.name || undefined,
      tenantId,
    });

    return {
      ok: true,
      platform: resolvedPlatform,
      destination: resolvedDestination,
      threadRef: resolvedThreadRef,
    };
  },
});
