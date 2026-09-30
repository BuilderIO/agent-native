import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  describeSourceConfigIssues,
  validateSourceConfig,
} from "../shared/source-config-validation.js";

const zoomSourceConfigSchema = z
  .object({
    userIds: z.array(z.string().trim().min(1)).max(50).optional(),
    lookbackDays: z.number().int().min(1).max(30).optional(),
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
      )}. Use {"zoom":{"userIds":["user@example.com"],"lookbackDays":7}} with up to 50 user IDs and 1-30 lookback days.`,
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
