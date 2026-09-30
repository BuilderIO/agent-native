import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  listOrgSettings,
  listSettingsByPrefix,
} from "@agent-native/core/settings";
import { z } from "zod";

import { listEventCatalog } from "../server/lib/session-event-index.js";
import { assertSessionsTriageLabEnabled } from "../server/lib/sessions-triage-lab.js";
import { eventDescriptionKey } from "../shared/session-events.js";

const DATA_DICTIONARY_PREFIX = "data-dict-";

async function dataDictionaryDescriptions(
  userEmail: string,
  orgId: string | null,
): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();
  const collect = (raw: unknown) => {
    const entry = raw as { metric?: unknown; definition?: unknown } | null;
    if (!entry || typeof entry !== "object") return;
    if (typeof entry.metric !== "string") return;
    if (typeof entry.definition !== "string" || !entry.definition.trim()) {
      return;
    }
    const key = eventDescriptionKey(entry.metric);
    if (key && !descriptions.has(key)) {
      descriptions.set(key, entry.definition.trim());
    }
  };
  if (orgId) {
    const orgEntries = await listOrgSettings(orgId, DATA_DICTIONARY_PREFIX);
    for (const value of Object.values(orgEntries)) collect(value);
  }
  // Scope the read in SQL so other users' settings never enter this action.
  const userEntries = await listSettingsByPrefix(
    `u:${userEmail}:${DATA_DICTIONARY_PREFIX}`,
  );
  for (const { value } of userEntries) collect(value);
  return descriptions;
}

export default defineAction({
  description:
    "List the events Analytics has received, with each event's app, volume in the range, last-seen time, sample property keys, and Data Dictionary description. Flags apps that send only automatic events and events that stopped firing. Reads Analytics' own index. Requires the Sessions triage Lab.",
  schema: z.object({
    from: z
      .string()
      .optional()
      .describe(
        "Inclusive lower bound as an ISO timestamp; defaults to 30 days ago",
      ),
    to: z
      .string()
      .optional()
      .describe("Inclusive upper bound as an ISO timestamp; defaults to now"),
    app: z.string().optional().describe("Optional app filter"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    await assertSessionsTriageLabEnabled(userEmail, orgId);
    const dictionary = await dataDictionaryDescriptions(userEmail, orgId);
    const result = await listEventCatalog(
      { userEmail, orgId },
      { from: args.from, to: args.to, app: args.app },
    );
    for (const entry of result.entries) {
      entry.description =
        dictionary.get(eventDescriptionKey(entry.eventName)) ?? null;
    }
    return result;
  },
});
