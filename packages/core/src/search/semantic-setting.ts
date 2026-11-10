/**
 * The organization switch for semantic search. It is on unless an owner or
 * admin turns it off. While it is off, none of the organization's text is
 * sent to an embedding provider, for indexing or for queries.
 */
import { getOrgSetting, mutateOrgSetting } from "../settings/org-settings.js";

export const SEMANTIC_SEARCH_SETTING_KEY = "semantic-search";

export interface SemanticSearchSetting {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

function parseSetting(
  value: Record<string, unknown> | null,
): SemanticSearchSetting {
  return {
    enabled: value?.enabled !== false,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
    updatedBy: typeof value?.updatedBy === "string" ? value.updatedBy : null,
  };
}

/**
 * Reads whether semantic search is on for an organization. Throws when the
 * setting can't be read, so callers never embed on a guess.
 */
export async function readSemanticSearchSetting(
  orgId: string,
): Promise<SemanticSearchSetting> {
  return parseSetting(await getOrgSetting(orgId, SEMANTIC_SEARCH_SETTING_KEY));
}

/** Turns semantic search on or off. Returns the setting before and after. */
export async function writeSemanticSearchSetting(
  orgId: string,
  input: { enabled: boolean; updatedBy: string },
): Promise<{ before: SemanticSearchSetting; after: SemanticSearchSetting }> {
  let before = parseSetting(null);
  const stored = await mutateOrgSetting(
    orgId,
    SEMANTIC_SEARCH_SETTING_KEY,
    (current) => {
      before = parseSetting(current);
      return {
        enabled: input.enabled,
        updatedAt: new Date().toISOString(),
        updatedBy: input.updatedBy,
      };
    },
  );
  return { before, after: parseSetting(stored) };
}
