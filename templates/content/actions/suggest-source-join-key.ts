import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import type {
  DocumentPropertyValue,
  SuggestSourceJoinKeyResponse,
} from "../shared/api.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client.js";
import { readLocalTableEntries } from "./_local-table-source.js";
import { suggestJoinKey } from "./_join-suggestion.js";

export default defineAction({
  description:
    "Suggest a canonical-key join (key field + normalization formula) between a database's existing source and a candidate second source, using a deterministic Jaccard-overlap heuristic. Read-only; no model call.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    candidateSourceType: z.enum(["mock-local", "builder-cms", "local-table"]),
    candidateSourceTable: z
      .string()
      .describe("Model/table name of the source being added."),
    sampleLimit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<SuggestSourceJoinKeyResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    const access = await resolveAccess("document", database.documentId);
    if (!access) throw new Error(`Database "${database.id}" not found`);

    const primary = await getContentDatabaseSourceSnapshot(database);
    if (!primary) {
      return {
        state: "no-primary",
        suggestion: null,
        message: "Attach a first source before federating a second one.",
      };
    }

    const primaryValues = primary.rows
      .map((row) => row.sourceValues)
      .filter((values): values is Record<string, DocumentPropertyValue> =>
        Boolean(values),
      )
      .slice(0, args.sampleLimit);

    let secondaryValues: Record<string, DocumentPropertyValue>[];
    if (args.candidateSourceType === "builder-cms") {
      const read = await readBuilderCmsContentEntries({
        model: args.candidateSourceTable,
      });
      secondaryValues = (read.state === "live" ? read.entries : [])
        .map((entry) => entry.sourceValues)
        .slice(0, args.sampleLimit);
    } else if (args.candidateSourceType === "local-table") {
      const { entries } = await readLocalTableEntries(
        args.candidateSourceTable,
        { limit: args.sampleLimit },
      );
      secondaryValues = entries
        .map((entry) => entry.sourceValues)
        .slice(0, args.sampleLimit);
    } else {
      secondaryValues = [];
    }

    const suggestion = suggestJoinKey({ primaryValues, secondaryValues });
    if (!suggestion) {
      return {
        state: "no-overlap",
        suggestion: null,
        message:
          "No overlapping key field found automatically — pick the join field and formula manually.",
      };
    }

    return { state: "ok", suggestion, message: null };
  },
});
