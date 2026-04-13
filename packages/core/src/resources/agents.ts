import {
  resourceGet,
  resourceGetByPath,
  resourceListAccessible,
  SHARED_OWNER,
} from "./store.js";
import {
  type CustomAgentProfile,
  parseCustomAgentProfile,
} from "./metadata.js";

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
        return parseCustomAgentProfile(full.content, resource.path);
      }),
  );

  return profiles.filter((profile): profile is CustomAgentProfile => !!profile);
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
      if (profile) return profile;
    }
    const shared = await resourceGetByPath(SHARED_OWNER, path);
    if (shared) {
      const profile = parseCustomAgentProfile(shared.content, shared.path);
      if (profile) return profile;
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
