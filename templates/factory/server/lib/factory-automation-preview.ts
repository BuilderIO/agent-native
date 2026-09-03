import { listAutomationDefinitions } from "@agent-native/core/triggers";

import { readFactoryDefinition } from "../factory-graph/store.js";
import { readFactoryAutomationConfig } from "./factory-automation-config.js";
import {
  DEFAULT_FACTORY_ID,
  readAutomationFactoryId,
  resolveAutomationDisplayName,
} from "./factory-scope.js";

export async function listFactoryAutomationPreview(
  userEmail: string,
  orgId: string,
  factoryId: string,
) {
  const factory = await readFactoryDefinition(orgId, factoryId);
  if (!factory && factoryId !== DEFAULT_FACTORY_ID) return [];
  const definitions = await listAutomationDefinitions(
    { userEmail, orgId, appId: "factory" },
    "organization",
  );
  return definitions.flatMap(({ resource, name, meta }) => {
    if (meta.domain !== "factory") return [];
    if (
      readAutomationFactoryId(meta, resource.content, resource.path) !==
      factoryId
    ) {
      return [];
    }
    const config = readFactoryAutomationConfig(resource.content, name);
    return [
      {
        id: resource.id,
        displayName: resolveAutomationDisplayName(name, resource.content),
        source: config.source,
        enabled: meta.enabled,
      },
    ];
  });
}
