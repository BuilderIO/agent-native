import { readFactoryDefinition } from "../factory-graph/store.js";
import { readFactoryAutomationConfig } from "./factory-automation-config.js";
import { listFactoryAutomationDefinitions } from "./factory-automation-resources.js";
import {
  DEFAULT_FACTORY_ID,
  resolveAutomationDisplayName,
} from "./factory-scope.js";

export async function listFactoryAutomationPreview(
  _userEmail: string,
  orgId: string,
  factoryId: string,
) {
  const factory = await readFactoryDefinition(orgId, factoryId);
  if (!factory && factoryId !== DEFAULT_FACTORY_ID) return [];
  const definitions = await listFactoryAutomationDefinitions(orgId, factoryId);
  return definitions.map(({ resource, name, meta }) => {
    const config = readFactoryAutomationConfig(resource.content, name);
    return {
      id: resource.id,
      displayName: resolveAutomationDisplayName(name, resource.content),
      source: config.source,
      enabled: meta.enabled,
    };
  });
}
