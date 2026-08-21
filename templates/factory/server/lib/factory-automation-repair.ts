import { getDb } from "../db/index.js";
import {
  ensureFactoryAutomations,
  syncFactoryAutomationEnabledStates,
} from "../plugins/factory-scheduler-job.js";
import { resolveEnabledAutomationsFromSavedConfig } from "./factory-automation-plan.js";
import { readTriageConfigRow } from "./factory-scope.js";

export async function repairFactoryAutomationsFromConfig(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
): Promise<void> {
  const config = await readTriageConfigRow(getDb(), orgId, factoryId);
  if (!config) return;
  const enabledNames = resolveEnabledAutomationsFromSavedConfig({
    pollingEnabled: config.pollingEnabled,
    githubPollingEnabled: config.githubPollingEnabled,
    sentryPollingEnabled: config.sentryPollingEnabled,
    slackChannelId: config.slackChannelId,
    repository: config.repository,
    sentryOrgSlug: config.sentryOrgSlug,
    sentryProjectSlug: config.sentryProjectSlug,
  });
  await ensureFactoryAutomations(ownerEmail, orgId, factoryId, {
    enabledNames,
  });
  await syncFactoryAutomationEnabledStates(ownerEmail, orgId, factoryId, [
    ...enabledNames,
  ]);
}
