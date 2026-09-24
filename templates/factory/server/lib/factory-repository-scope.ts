import type { ActionRunContext } from "@agent-native/core/action";

import type { getDb } from "../db/index.js";
import { readCallingFactoryAutomation } from "./factory-automation-caller.js";
import { readTriageConfigRow } from "./factory-scope.js";
import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";

type Db = ReturnType<typeof getDb>;

/**
 * The repository a factory is authorized to act on. A factory polled by an
 * automation can have an empty config row, so a gate that reads only the row
 * rejects the very pull requests that automation put in the inbox. Every
 * GitHub gate resolves through this rule so babysitting, governance, and
 * polling cannot disagree about which repository is in scope.
 */
export function factoryRepositoryFromSources(
  automationRepository: string | null | undefined,
  configRepository: string | null | undefined,
): string | null {
  return automationRepository?.trim() || configRepository?.trim() || null;
}

/** {@link factoryRepositoryFromSources} for callers that have read neither source. */
export async function resolveFactoryRepository(
  db: Db,
  context: ActionRunContext | undefined,
  identity: Pick<WorkspaceMemberIdentity, "userEmail" | "orgId">,
  factoryId: string,
): Promise<string | null> {
  const job = await readCallingFactoryAutomation(context, identity);
  const fromAutomation = job?.config.repository?.trim();
  if (fromAutomation) return fromAutomation;
  const row = await readTriageConfigRow(db, identity.orgId, factoryId);
  return factoryRepositoryFromSources(null, row?.repository);
}
