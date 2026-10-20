import { getDb } from "../db/index.js";
import {
  DEFAULT_FACTORY_ID,
  readFactoryDefinition,
} from "../factory-graph/store.js";
import { ensureFactoryAutomations } from "../plugins/factory-scheduler-job.js";
import { readTriageConfigRow } from "./factory-scope.js";

export async function repairFactoryAutomationsFromConfig(
  ownerEmail: string,
  orgId: string,
  factoryId: string,
): Promise<void> {
  const factory = await readFactoryDefinition(orgId, factoryId);
  if (!factory && factoryId !== DEFAULT_FACTORY_ID) return;
  const config = await readTriageConfigRow(getDb(), orgId, factoryId);
  if (!config) return;
  await ensureFactoryAutomations(ownerEmail, orgId, factoryId, {
    enabled: false,
  });
}
