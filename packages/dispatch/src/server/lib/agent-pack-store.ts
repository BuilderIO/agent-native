import {
  applyWorkspaceResourceCreate,
  listWorkspaceResources,
  type WorkspaceResourceInput,
} from "./workspace-resources-store.js";

/**
 * Apply a pack as one logical operation. Approval is handled by the action
 * before this helper is called, so this function must never call the
 * approval-aware create wrapper for individual files.
 */
export async function applyAgentPackCreate(
  inputs: WorkspaceResourceInput[],
  actor?: string,
  ctx?: { ownerEmail: string; orgId: string | null },
) {
  const existing = await listWorkspaceResources();
  const existingPaths = new Set(existing.map((resource) => resource.path));
  const duplicate = inputs.find((input) => existingPaths.has(input.path));
  if (duplicate) {
    throw new Error(
      `An agent pack resource already exists at ${duplicate.path}. Rename the source before importing it.`,
    );
  }

  const created = [];
  for (const input of inputs) {
    const resource = await applyWorkspaceResourceCreate(input, actor, ctx);
    if (resource) created.push(resource);
  }
  return created;
}
