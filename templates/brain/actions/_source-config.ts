import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  describeSourceConfigIssues,
  validateSourceConfig,
} from "../shared/source-config-validation.js";
import {
  normalizeZoomMeetingId,
  normalizeZoomMeetingTopic,
} from "../shared/zoom-meeting-filter.js";

const zoomSourceConfigSchema = z
  .object({
    userIds: z.array(z.string().trim().min(1)).max(50).optional(),
    lookbackDays: z.number().int().min(1).max(30).optional(),
    meetingIds: z
      .array(
        z
          .union([z.string(), z.number()])
          .refine((value) => normalizeZoomMeetingId(value) !== null, {
            message: "must be a Zoom meeting ID like 123 4567 8901",
          }),
      )
      .max(100)
      .optional(),
    meetingTopics: z
      .array(
        z
          .string()
          .refine((value) => normalizeZoomMeetingTopic(value) !== null, {
            message: "must be a non-empty meeting title",
          }),
      )
      .max(100)
      .optional(),
  })
  .passthrough();

function assertValidZoomConfig(config: Record<string, unknown>) {
  if (config.zoom === undefined) return;
  const parsed = zoomSourceConfigSchema.safeParse(config.zoom);
  if (parsed.success) return;
  const issues = parsed.error.issues.map((issue) => ({
    field: ["zoom", ...issue.path].join("."),
    message: issue.message,
  }));
  fail(
    `Invalid Zoom source config: ${issues
      .map((issue) => `${issue.field} ${issue.message}`)
      .join(
        "; ",
      )}. Use {"zoom":{"meetingIds":["123 4567 8901"],"meetingTopics":["Weekly Sync"],"userIds":["user@example.com"],"lookbackDays":7}} with up to 100 meeting IDs or titles, up to 50 user IDs, and 1-30 lookback days.`,
    {
      errorCode: "invalid_source_config",
      details: { issues },
    },
  );
}

// Model gateways drop the keys of free-form object parameters, so agents send
// source config as a JSON string instead.
export const sourceConfigJsonSchema = z
  .string()
  .optional()
  .describe(
    'Provider configuration as a JSON object encoded in a string, for example "{\\"zoom\\":{\\"lookbackDays\\":7}}". Agents must use this instead of config.',
  );

export function mergeSourceConfigJson(
  config: Record<string, unknown> | undefined,
  configJson: string | undefined,
): Record<string, unknown> | undefined {
  if (configJson === undefined || !configJson.trim()) return config;
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("configJson must be a JSON object encoded as a string.", {
      errorCode: "invalid_source_config",
    });
  }
  return { ...config, ...(parsed as Record<string, unknown>) };
}

export function assertValidSourceConfig(
  provider: string,
  config: Record<string, unknown>,
) {
  if (provider === "zoom") assertValidZoomConfig(config);
  const issues = validateSourceConfig(provider, config);
  if (!issues.length) return;
  fail(describeSourceConfigIssues(issues), {
    errorCode: "invalid_source_config",
    details: { issues },
  });
}
