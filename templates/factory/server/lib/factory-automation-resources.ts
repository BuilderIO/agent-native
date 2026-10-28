import {
  parseJobResource,
  recoveredFactoryOwnerOrgId,
  type JobFrontmatter,
} from "@agent-native/core/jobs/frontmatter";
import {
  organizationResourceOwner,
  resourceListContentByOwnersAndPrefixes,
  type Resource,
} from "@agent-native/core/resources";

import {
  DEFAULT_FACTORY_ID,
  factoryAutomationJobPrefixes,
  factoryAutomationRunHistoryKey,
  isLegacyFactoryAutomationPath,
} from "./factory-scope.js";
import { WORKFLOW_JOB_APP_ID } from "./factory-workflow-runner.js";

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

// Core's recovery rule admits a Factory file whose appId is missing or
// `factory`. A workflow job's own appId is neither, so it is checked as the
// file it would be without one: same folder, same organization owner.
function isFactoryJob(meta: JobFrontmatter, resource: Resource): boolean {
  const { appId, ...withoutAppId } = meta;
  const recoverable =
    appId?.trim() === WORKFLOW_JOB_APP_ID ? withoutAppId : meta;
  return (
    recoveredFactoryOwnerOrgId(recoverable, resource.path, resource.owner) !==
    null
  );
}

function resourceFromContentProjection(row: {
  id: string;
  path: string;
  owner: string;
  content: string;
}): Resource {
  return {
    id: row.id,
    path: row.path,
    owner: row.owner,
    content: row.content,
    mimeType: "text/markdown",
    size: row.content.length,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

export function factoryIdFromAutomationName(name: string): string | null {
  const nested = name.match(/^factories\/([^/]+)\//);
  if (nested?.[1]) return nested[1];
  if (/^factory-[^/]+$/.test(name)) return DEFAULT_FACTORY_ID;
  return null;
}

export async function listFactoryAutomationDefinitions(
  orgId: string,
  factoryId: string,
): Promise<FactoryAutomationDefinition[]> {
  const owner = organizationResourceOwner(orgId);
  const listed = await resourceListContentByOwnersAndPrefixes(
    [owner],
    factoryAutomationJobPrefixes(factoryId),
  );
  const unique = new Map(listed.map((row) => [row.path, row]));
  return [...unique.values()]
    .filter((row) => row.path.endsWith(".md") && !row.path.endsWith(".keep"))
    .filter((row) => jobBelongsToFactory(row.path, factoryId))
    .map((row) => {
      const resource = resourceFromContentProjection(row);
      const { meta, body } = parseJobResource(resource.content);
      return {
        name: factoryAutomationRunHistoryKey(resource.path),
        resource,
        meta,
        body,
      };
    })
    .filter(({ resource, meta }) => isFactoryJob(meta, resource))
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

export async function findFactoryAutomationByResourceId(
  orgId: string,
  resourceId: string,
): Promise<(FactoryAutomationDefinition & { factoryId: string }) | null> {
  const { listFactoryDefinitions } = await import("./factory-definitions.js");
  const { DEFAULT_FACTORY_ID, readAutomationFactoryId } =
    await import("./factory-scope.js");
  const factories = await listFactoryDefinitions(orgId);
  const factoryIds = [
    ...new Set([DEFAULT_FACTORY_ID, ...factories.map((row) => row.id)]),
  ];
  for (const factoryId of factoryIds) {
    const definition = await findFactoryAutomationDefinition(
      orgId,
      factoryId,
      resourceId,
    );
    if (definition) {
      return {
        ...definition,
        factoryId: readAutomationFactoryId(
          definition.meta,
          definition.resource.content,
          definition.resource.path,
        ),
      };
    }
  }
  return null;
}
