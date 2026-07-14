import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  DocumentPropertyValue,
  SuggestSourceJoinKeyResponse,
} from "../shared/api.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
} from "./_builder-cms-read-client.js";
import { getContentDatabaseSourceAdapter } from "./_content-database-source-adapters.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { suggestJoinKey } from "./_join-suggestion.js";
import { readLocalTableEntries } from "./_local-table-source.js";

export default defineAction({
  description:
    "Suggest a canonical-key join (key field + normalization formula) between a database's existing source and a candidate second source, using a deterministic Jaccard-overlap heuristic. Read-only; no model call.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    candidateSourceType: z.enum([
      "mock-local",
      "builder-cms",
      "local-table",
      "notion-database",
    ]),
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
    const primaryValues = primary
      ? primary.rows
          .map((row) => row.sourceValues)
          .filter((values): values is Record<string, DocumentPropertyValue> =>
            Boolean(values),
          )
          .slice(0, args.sampleLimit)
      : (
          await getContentDatabaseResponse(database.id, {
            limit: args.sampleLimit,
            offset: 0,
          })
        ).items.map((item) => ({
          title: item.document.title ?? "",
          ...Object.fromEntries(
            item.properties
              .filter((property) => !!property.definition.id)
              .map((property) => [property.definition.id, property.value]),
          ),
        }));

    let secondaryValues: Record<string, DocumentPropertyValue>[];
    if (args.candidateSourceType === "notion-database") {
      const adapter = getContentDatabaseSourceAdapter(args.candidateSourceType);
      const read = await adapter!.read({
        sourceTable: args.candidateSourceTable,
        limit: args.sampleLimit,
        offset: 0,
      });
      secondaryValues = read.entries
        .map((entry) => entry.sourceValues)
        .slice(0, args.sampleLimit);
    } else if (args.candidateSourceType === "builder-cms") {
      const modelFields = await readBuilderCmsModelFields({
        model: args.candidateSourceTable,
      }).catch(() => []);
      const read = await readBuilderCmsContentEntries({
        model: args.candidateSourceTable,
        fieldPaths: modelFields.map((field) => `data.${field.name}`),
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
