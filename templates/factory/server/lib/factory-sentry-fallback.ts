import { getDb } from "../db/index.js";
import { readTriageConfigRow } from "./factory-scope.js";

/**
 * Whether the factory's settings name a Sentry organization. A workflow's
 * Sentry Source that names no project polls this one: `poll-sentry-errors`
 * fails with "Configure a Sentry organization" when neither exists.
 */
export async function readSentryFallbackConfigured(
  orgId: string,
  factoryId: string,
): Promise<boolean> {
  const config = await readTriageConfigRow(getDb(), orgId, factoryId);
  return Boolean(config?.sentryOrgSlug?.trim());
}
