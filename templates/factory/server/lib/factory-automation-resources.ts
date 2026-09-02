import {
  parseJobFrontmatter,
  type JobFrontmatter,
} from "@agent-native/core/jobs";
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

function jobBelongsToFactory(path: string, factoryId: string): boolean {
  const nested = path.match(/^jobs\/factories\/([^/]+)\//);
  if (nested) return nested[1] === factoryId;
  return (
    factoryId === DEFAULT_FACTORY_ID && isLegacyFactoryAutomationPath(path)
  );
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
      const { meta, body } = parseJobFrontmatter(resource.content);
      return {
        name: factoryAutomationRunHistoryKey(resource.path),
        resource,
        meta,
        body,
      };
    })
    .sort((a, b) => a.resource.path.localeCompare(b.resource.path));
}
