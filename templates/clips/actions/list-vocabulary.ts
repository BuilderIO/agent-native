import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  getOrganizationRoleForEmail,
} from "../server/lib/recordings.js";
import {
  TEAM_VOCABULARY_EDITOR_ROLES,
  mergeVocabulary,
  vocabularyScope,
} from "../server/lib/vocabulary.js";

async function canManageTeamVocabulary(): Promise<boolean> {
  const email = getRequestUserEmail();
  if (!email) return false;
  try {
    const orgId = await getActiveOrganizationId();
    if (!orgId) return false;
    const role = await getOrganizationRoleForEmail(orgId, email);
    return (
      role === "owner" ||
      (TEAM_VOCABULARY_EDITOR_ROLES as readonly string[]).includes(role ?? "")
    );
  } catch {
    return false;
  }
}

export default defineAction({
  description:
    'List the vocabulary dictation uses: the current user\'s personal entries (auto-learned from post-paste dictation edits or added by hand) plus the team entries of their organization. Each entry has scope "personal" or "team"; a personal entry with the same term hides the team entry in `vocabulary`. `team` lists every team entry, and `canManageTeam` says whether the user may add or remove them.',
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.vocabulary)
      .where(and(accessFilter(schema.vocabulary, schema.vocabularyShares)))
      .orderBy(desc(schema.vocabulary.usesCount))
      .limit(args.limit);
    const team = rows
      .filter((row) => vocabularyScope(row) === "team")
      .map((row) => ({ ...row, scope: "team" as const }))
      .sort((a, b) => a.term.localeCompare(b.term));
    return {
      vocabulary: mergeVocabulary(rows),
      team,
      canManageTeam: await canManageTeamVocabulary(),
    };
  },
});
