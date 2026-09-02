import {
  parseJobResource,
  type JobFrontmatter,
} from "@agent-native/core/jobs/frontmatter";
import {
  organizationResourceOwner,
  resourceGetByPath,
  resourceList,
  type Resource,
} from "@agent-native/core/resources";

import {
  DEFAULT_FACTORY_ID,
  factoryAutomationJobPrefixes,
  factoryAutomationRunHistoryKey,
  isLegacyFactoryAutomationPath,
} from "./factory-scope.js";

export type FactoryAutomationDefinition = {
  name: string;
  resource: Resource;
  meta: JobFrontmatter;
  body: string;
};

const FACTORY_APP_ID = "factory";

function jobBelongsToFactory(path: string, factoryId: string): boolean {
  const nested = path.match(/^jobs\/factories\/([^/]+)\//);
  if (nested) return nested[1] === factoryId;
  return (
    factoryId === DEFAULT_FACTORY_ID && isLegacyFactoryAutomationPath(path)
  );
}

/** Path is membership; an explicit other-app owner still stays out. Missing appId is a recovered Factory job. */
function isFactoryAppOwned(meta: JobFrontmatter): boolean {
  const appId = meta.appId?.trim();
  if (appId) return appId === FACTORY_APP_ID;
  return true;
}

export function factoryIdFromAutomationName(name: string): string | null {
  const nested = name.match(/^factories\/([^/]+)\//);
  if (nested?.[1]) return nested[1];
  if (/^factory-[^/]+$/.test(name)) return DEFAULT_FACTORY_ID;
  return null;
}

/**
 * Load Factory jobs by their stored path. Membership is the folder (or the
 * default-factory `jobs/factory-*.md` convention), not `domain` / `triggerType`.
 * A scheduler status write that dropped those tags must not hide the job.
 */
export async function listFactoryAutomationDefinitions(
  orgId: string,
  factoryId: string,
): Promise<FactoryAutomationDefinition[]> {
  const owner = organizationResourceOwner(orgId);
  const listed = (
    await Promise.all(
      factoryAutomationJobPrefixes(factoryId).map((prefix) =>
        resourceList(owner, prefix),
      ),
    )
  ).flat();
  const unique = new Map(listed.map((meta) => [meta.path, meta]));
  const jobs = [...unique.values()].filter(
    (meta) => meta.path.endsWith(".md") && !meta.path.endsWith(".keep"),
  );
  const resources = await Promise.all(
    jobs.map((meta) => resourceGetByPath(meta.owner, meta.path)),
  );
  return resources
    .filter((resource): resource is Resource => resource !== null)
    .filter((resource) => jobBelongsToFactory(resource.path, factoryId))
    .map((resource) => {
      const { meta, body } = parseJobResource(resource.content);
      return {
        name: factoryAutomationRunHistoryKey(resource.path),
        resource,
        meta,
        body,
      };
    })
    .filter(({ meta }) => isFactoryAppOwned(meta))
    .sort((a, b) => a.resource.path.localeCompare(b.resource.path));
}

export async function findFactoryAutomationDefinition(
  orgId: string,
  factoryId: string,
  automationId: string,
): Promise<FactoryAutomationDefinition | null> {
  const definitions = await listFactoryAutomationDefinitions(orgId, factoryId);
  return (
    definitions.find((entry) => entry.resource.id === automationId) ?? null
  );
}
