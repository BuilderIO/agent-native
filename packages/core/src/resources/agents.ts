import {
  getResourceKind,
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
