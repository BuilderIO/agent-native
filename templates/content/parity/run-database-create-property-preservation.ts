import { createAgentRunner, runEvals } from "@agent-native/core/eval";

import addDatabaseItem from "../actions/add-database-item.ts";
import getContentDatabase from "../actions/get-content-database.ts";
import listContentDatabases from "../actions/list-content-databases.ts";
import { parityEvalScenarios } from "./eval-scenarios.ts";
import { scenarioToEval } from "./scenario-to-eval.ts";

const scenario = parityEvalScenarios.find(
  (candidate) => candidate.id === "database-create-property-preservation",
);
if (!scenario) {
  throw new Error("Missing database create property preservation scenario.");
}

const FIXTURE_SPACE_ID = "fixture_personal_space";
const FIXTURE_DATABASE_ID = "fixture_feedback_database";
const FIXTURE_DOCUMENT_ID = "fixture_feedback_document";
const FIXTURE_SCHEMA_REVISION = "fixture_schema_revision";
const FIXTURE_DATABASE_TITLE = "PR #3314 feedback";

const evalCase = scenarioToEval(scenario);
evalCase.scorers = evalCase.scorers.filter(
  (scorer) =>
    scorer.name === "expected_tools" ||
    scorer.name === "expected_property_values",
);

const runner = await createAgentRunner({
  actions: {
    "list-content-databases": {
      ...listContentDatabases,
      run: async () => ({
        databases: [
          {
            databaseId: FIXTURE_DATABASE_ID,
            documentId: FIXTURE_DOCUMENT_ID,
            spaceId: FIXTURE_SPACE_ID,
            title: FIXTURE_DATABASE_TITLE,
            description: "",
          },
        ],
        pagination: {
          offset: 0,
          limit: 50,
          totalItems: 1,
          returnedItems: 1,
          hasMore: false,
          nextOffset: null,
        },
      }),
    },
    "get-content-database": {
      ...getContentDatabase,
      run: async () => ({
        database: {
          id: FIXTURE_DATABASE_ID,
          documentId: FIXTURE_DOCUMENT_ID,
          spaceId: FIXTURE_SPACE_ID,
          title: FIXTURE_DATABASE_TITLE,
          naturalKeyPropertyId: null,
          viewConfig: {
            activeViewId: "fixture_view",
            views: [],
            sorts: [],
            filters: [],
            columnWidths: {},
          },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        properties: [],
        items: [],
        source: null,
        mutationContract: {
          target: {
            authorityScope: {
              kind: "personal",
              id: "fixture-owner@example.com",
            },
            spaceId: FIXTURE_SPACE_ID,
            databaseId: FIXTURE_DATABASE_ID,
            databaseDocumentId: FIXTURE_DOCUMENT_ID,
          },
          schemaRevision: FIXTURE_SCHEMA_REVISION,
          naturalKeyPropertyId: null,
          properties: [
            {
              id: "fixture_status_property",
              name: "Status",
              type: "status",
              writable: true,
              sourceManaged: false,
              acceptedShape: null,
              options: {
                options: [
                  {
                    id: "status-cannot-verify",
                    name: "Cannot verify",
                    color: "gray",
                  },
                ],
              },
            },
            {
              id: "fixture_evidence_property",
              name: "Evidence",
              type: "text",
              writable: true,
              sourceManaged: false,
              acceptedShape: null,
              options: {},
            },
          ],
        },
      }),
    },
    "add-database-item": {
      ...addDatabaseItem,
      run: async (input) => ({ fixtureOnly: true, received: input }),
    },
  },
  systemPrompt:
    "You are Content's AI document assistant. Use the registered Content actions and preserve exact user-supplied target constraints, property IDs, and property values. Never invent fields or claim an action succeeded when it failed.",
});

const report = await runEvals([evalCase], runner, { persist: false });
console.log(
  JSON.stringify(
    {
      engine: runner.engine.name,
      model: runner.model,
      report,
    },
    null,
    2,
  ),
);

process.exitCode = report.failed === 0 ? 0 : 1;
