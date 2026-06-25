import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { parseJson } from "../server/lib/brain.js";
import { testSlackConnection } from "../server/lib/connectors.js";

function channelRefsFromConfig(config: Record<string, unknown>) {
  const values: string[] = [];
  const nested =
    config.slack && typeof config.slack === "object"
      ? (config.slack as Record<string, unknown>)
      : {};
  for (const itemConfig of [config, nested]) {
    for (const key of [
      "channelIds",
      "channels",
      "allowedChannels",
      "allowlistedChannels",
      "allowList",
    ]) {
      const raw = itemConfig[key];
      if (typeof raw === "string") values.push(...raw.split(","));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string") values.push(item);
        }
      }
    }
  }
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.replace(/^#/, "")),
    ),
  );
}

export default defineAction({
  description:
    "Safely test the Slack bot token and optional allow-listed channels without reading message history.",
  schema: z.object({
    sourceId: z
      .string()
      .optional()
      .describe(
        "Optional Slack source whose configured channels should be validated.",
      ),
    channelRefs: z
      .union([z.array(z.string()), z.string()])
      .default([])
      .transform((value) =>
        Array.isArray(value)
          ? value
          : value
              .split(/[\n,]/g)
              .map((item) => item.trim())
              .filter(Boolean),
      )
      .describe(
        "Optional Slack channel IDs or names to validate. Accepts an array or comma/newline string. Message history is never read.",
      ),
    resolveNames: z.coerce
      .boolean()
      .default(false)
      .describe(
        "When true, channel names may be resolved through conversations.list metadata. Channel IDs avoid that metadata scan.",
      ),
  }),
  run: async ({ sourceId, channelRefs, resolveNames }) => {
    let refs = channelRefs;
    if (sourceId) {
      const access = await resolveAccess("brain-source", sourceId);
      if (!access) throw new Error(`No access to brain source ${sourceId}`);
      if (access.resource.provider !== "slack") {
        throw new Error(
          "test-slack-connection sourceId must reference a Slack source.",
        );
      }
      refs = refs.length
        ? refs
        : channelRefsFromConfig(parseJson(access.resource.configJson, {}));
    }
    const result = await testSlackConnection({
      channelRefs: refs,
      resolveNames,
    });
    return { ...result, sourceId: sourceId ?? null };
  },
});
