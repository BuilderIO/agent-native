import {
  AGENT_IMPORT_ERROR_CODES,
  failAgentImport,
} from "../../lib/agent-import-errors.js";
import {
  applyWorkspaceResourceCreate,
  getWorkspaceResourceByPath,
  requireWorkspaceResourceCtx,
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
  const resourceCtx = ctx ?? requireWorkspaceResourceCtx();
  const existing = await Promise.all(
    inputs.map((input) => getWorkspaceResourceByPath(input.path, resourceCtx)),
  );
  const duplicate = existing.find(Boolean);
  if (duplicate) {
    failAgentImport(
      `An agent pack resource already exists at ${duplicate.path}. Rename the source before importing it.`,
      AGENT_IMPORT_ERROR_CODES.duplicate,
      { statusCode: 409 },
    );
  }

  const created = [];
  for (const input of inputs) {
    const resource = await applyWorkspaceResourceCreate(input, actor, ctx);
    if (resource) created.push(resource);
  }
  return created;
}
