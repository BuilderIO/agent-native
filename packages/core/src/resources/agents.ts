import type { AgentSubmissionReference } from "@agent-native/agentkit/protocol";

import {
  getResourceKind,
  isCustomAgentPath,
  type CustomAgentProfile,
  type AgentWorkspaceResource,
  parseCustomAgentProfile,
} from "./metadata.js";
import {
  resourceGet,
  resourceGetByPath,
  resourceListAccessible,
  SHARED_OWNER,
  type ResourceMeta,
} from "./store.js";

/** Matches the bound-chat action's own bound on a recorded resource id. */
const MAX_CUSTOM_AGENT_RESOURCE_ID_LENGTH = 200;

function metadataFields(
  metadata: string | null,
): Record<string, unknown> | null {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
    // coercion-ok: malformed resource metadata is absent, not a valid profile field
  } catch (_error) {
    return null;
  }
}

async function enrichAgentProfile(
  owner: string,
  profile: CustomAgentProfile,
  accessibleResources?: ResourceMeta[],
): Promise<CustomAgentProfile> {
  const root = profile.path.replace(/\.md$/i, "");
  const resources =
    accessibleResources ?? (await resourceListAccessible(owner, `${root}/`));
  const workspace: AgentWorkspaceResource[] = resources.map((resource) => {
    const metadata = metadataFields(resource.metadata) ?? {};
    return {
      path: resource.path,
      kind: getResourceKind(resource.path),
      name: typeof metadata.name === "string" ? metadata.name : undefined,
      description:
        typeof metadata.description === "string"
          ? metadata.description
          : undefined,
    };
  });
  return { ...profile, workspace: { root, resources: workspace } };
}

export async function listAccessibleCustomAgents(
  owner: string,
): Promise<CustomAgentProfile[]> {
  const resources = await resourceListAccessible(owner, "agents/");
  const profiles = await Promise.all(
    resources
      .filter((resource) => resource.path.endsWith(".md"))
      .map(async (resource) => {
        const full = await resourceGet(resource.id);
        if (!full) return null;
        const profile = parseCustomAgentProfile(full.content, resource.path);
        return profile;
      }),
  );

  const validProfiles = profiles.filter(
    (profile): profile is CustomAgentProfile => !!profile,
  );
  return Promise.all(
    validProfiles.map((profile) => {
      const root = `${profile.path.replace(/\.md$/i, "")}/`;
      return enrichAgentProfile(
        owner,
        profile,
        resources.filter((resource) => resource.path.startsWith(root)),
      );
    }),
  );
}

export async function findAccessibleCustomAgent(
  owner: string,
  identifier: string,
): Promise<CustomAgentProfile | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const byPathCandidates = [
    trimmed,
    trimmed.endsWith(".md") ? trimmed : `agents/${trimmed}.md`,
    trimmed.startsWith("agents/") ? trimmed : `agents/${trimmed}`,
  ];

  for (const path of byPathCandidates) {
    const personal = await resourceGetByPath(owner, path);
    if (personal) {
      const profile = parseCustomAgentProfile(personal.content, personal.path);
      if (profile) return enrichAgentProfile(owner, profile);
    }
    const shared = await resourceGetByPath(SHARED_OWNER, path);
    if (shared) {
      const profile = parseCustomAgentProfile(shared.content, shared.path);
      if (profile) return enrichAgentProfile(owner, profile);
    }
  }

  const lower = trimmed.toLowerCase();
  const agents = await listAccessibleCustomAgents(owner);
  return (
    agents.find(
      (agent) =>
        agent.id.toLowerCase() === lower ||
        agent.name.toLowerCase() === lower ||
        agent.path.toLowerCase() === lower,
    ) ?? null
  );
}

/**
 * Resolves a custom agent by the durable resource id a bound chat recorded.
 *
 * A path lookup cannot tell this profile apart from one later created at the
 * same path, so the listing only locates the id and the profile itself is read
 * back fresh by id. A missing, trashed, foreign, renamed-out-of-`agents/`, or
 * concurrently transferred row fails closed — there is no path or name
 * fallback, even when that path currently holds a valid profile.
 */
export async function findAccessibleCustomAgentByResourceId(
  owner: string,
  resourceId: string,
): Promise<CustomAgentProfile | null> {
  const listed = (await resourceListAccessible(owner, "agents/")).find(
    (resource) => resource.id === resourceId,
  );
  if (!listed) return null;

  const fresh = await resourceGet(resourceId);
  if (!fresh) return null;
  if (fresh.id !== resourceId) return null;
  // The listing already applied the current organization's access filter, so
  // matching its owner rejects a row that changed hands after it was listed.
  if (fresh.owner !== listed.owner) return null;
  if (!isCustomAgentPath(fresh.path)) return null;

  const profile = parseCustomAgentProfile(fresh.content, fresh.path);
  if (!profile) return null;
  return enrichAgentProfile(owner, profile);
}

/**
 * Resolves the profile a run reference names.
 *
 * A reference whose metadata carries a `resourceId` (a bound chat) is resolved
 * strictly by that id. Without the property, ordinary path, name, and profile
 * id resolution is unchanged. A present but malformed id fails closed instead
 * of falling back, so a stale cached reference never executes whatever now
 * occupies its old path.
 *
 * `findLegacy` defaults to `findAccessibleCustomAgent`. A caller that owns the
 * module binding (the production run) passes it in so module spies and
 * `vi.mock` overrides of that helper stay effective; an internal call site
 * could not honor them.
 */
export async function resolveAccessibleCustomAgentReference(
  owner: string,
  reference: AgentSubmissionReference,
  findLegacy: typeof findAccessibleCustomAgent = findAccessibleCustomAgent,
): Promise<CustomAgentProfile | null> {
  const metadata = reference.metadata;
  if (
    metadata &&
    Object.prototype.hasOwnProperty.call(metadata, "resourceId")
  ) {
    const resourceId = metadata.resourceId;
    if (
      typeof resourceId !== "string" ||
      resourceId.length === 0 ||
      resourceId.length > MAX_CUSTOM_AGENT_RESOURCE_ID_LENGTH
    ) {
      return null;
    }
    return findAccessibleCustomAgentByResourceId(owner, resourceId);
  }

  return findLegacy(owner, reference.refId || reference.path || reference.name);
}
