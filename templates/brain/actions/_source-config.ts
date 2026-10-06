import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  normalizeZoomMeetingId,
  normalizeZoomMeetingTopic,
} from "../server/lib/zoom.js";
import {
  describeSourceConfigIssues,
  validateSourceConfig,
} from "../shared/source-config-validation.js";

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
