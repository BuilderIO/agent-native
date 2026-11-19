import { describe, expect, it } from "vitest";

import { DATABASE_RESULT_MUTATIONS } from "../app/hooks/content-action-refresh.js";
import addDatabaseItem from "./add-database-item.js";
import configureDocumentProperty from "./configure-document-property.js";
import deleteContentDatabase from "./delete-content-database.js";
import migrateContentDatabaseRows from "./migrate-content-database-rows.js";
import patchDatabaseItems from "./patch-database-items.js";
import restoreContentDatabase from "./restore-content-database.js";
import updateContentDatabaseView from "./update-content-database-view.js";
import updateDatabaseItem from "./update-database-item.js";
import updateDatabaseItems from "./update-database-items.js";
import upsertDatabaseItemByKey from "./upsert-database-item-by-key.js";

// An open table refreshes on these actions' change events. One that names no
// resource reaches the open table only at its idle poll, 1 to 5 minutes away:
// an agent's row write took 107 seconds to show on beta. Naming the table's
// page lets the table's own ~12 second poll notice it and check at once.
const actions = Object.fromEntries(
  await Promise.all(
    [...DATABASE_RESULT_MUTATIONS].map(async (name) => {
      const loaded = (await import(`./${name}.ts`)) as {
        default: { mcpTool?: boolean; changeResource?: unknown };
      };
      return [name, loaded.default] as const;
    }),
  ),
);
const agentCallable = Object.keys(actions).filter(
  (name) => actions[name]?.mcpTool === true,
);

const target = {
  spaceId: "space-1",
  databaseId: "table-1",
  databaseDocumentId: "table-page",
};
const tablePage = { resourceType: "document", resourceId: "table-page" };

function named(
  action: { changeResource?: (input: never, result: never) => unknown },
  input: unknown,
  result?: unknown,
) {
  return action.changeResource?.(input as never, result as never);
}

describe("table writes an agent can call over MCP", () => {
  it("include the row, property and view writes", () => {
    expect(agentCallable).toEqual(
      expect.arrayContaining([
        "add-database-item",
        "configure-document-property",
        "patch-database-items",
        "update-content-database-view",
        "update-database-item",
        "update-database-items",
        "upsert-database-item-by-key",
      ]),
    );
  });

  it.each(agentCallable)("%s names the resource it changed", (name) => {
    expect(actions[name]?.changeResource).toBeTypeOf("function");
  });
});

describe("table writes name the table's page", () => {
  it.each([
    ["add-database-item", addDatabaseItem],
    ["update-database-item", updateDatabaseItem],
    ["patch-database-items", patchDatabaseItems],
    ["upsert-database-item-by-key", upsertDatabaseItemByKey],
  ] as const)("%s, from its target", (_name, action) => {
    expect(named(action, { target })).toEqual(tablePage);
  });

  it("update-database-items, from its result", () => {
    expect(
      named(
        updateDatabaseItems,
        { databaseId: "table-1" },
        { databaseDocumentId: "table-page" },
      ),
    ).toEqual(tablePage);
    // A failed call has no result.
    expect(named(updateDatabaseItems, { databaseId: "table-1" })).toBeNull();
  });

  it.each([
    ["configure-document-property", configureDocumentProperty],
    ["update-content-database-view", updateContentDatabaseView],
  ] as const)("%s, for an agent's call", (_name, action) => {
    expect(named(action, { operation: "update", target })).toEqual(tablePage);
    // The app's own calls carry no exact target.
    expect(named(action, { databaseId: "table-1" })).toBeNull();
  });

  it.each([
    ["delete-content-database", deleteContentDatabase],
    ["restore-content-database", restoreContentDatabase],
  ] as const)("%s, for an agent's call", (_name, action) => {
    expect(named(action, { target })).toEqual(tablePage);
    expect(named(action, { databaseId: "table-1" })).toBeNull();
  });

  it("migrate-content-database-rows, only when it applies", () => {
    expect(
      named(migrateContentDatabaseRows, {
        phase: "apply",
        plan: { databaseDocumentId: "table-page" },
      }),
    ).toEqual(tablePage);
    expect(
      named(migrateContentDatabaseRows, {
        phase: "validate",
        plan: { databaseDocumentId: "table-page" },
      }),
    ).toBeNull();
  });
});
