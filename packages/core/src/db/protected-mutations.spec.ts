import { afterEach, describe, expect, it } from "vitest";

import {
  __resetProtectedMutationTables,
  assertMutationTableIsNotProtected,
  assertSqlDoesNotMutateProtectedTable,
  registerProtectedMutationTables,
} from "./protected-mutations.js";

describe("protected mutation tables", () => {
  afterEach(() => __resetProtectedMutationTables());

  it("rejects raw writes to registered domain tables", () => {
    registerProtectedMutationTables({
      tables: ["documents", "document_property_values"],
      guidance: "Use a Content action instead.",
    });

    expect(() =>
      assertSqlDoesNotMutateProtectedTable(
        "UPDATE documents SET title = ? WHERE id = ?",
      ),
    ).toThrow(/durable change events.*Content action/i);
    expect(() =>
      assertSqlDoesNotMutateProtectedTable(
        "INSERT INTO document_property_values (id) VALUES (?)",
      ),
    ).toThrow(/protected/i);
  });

  it("normalizes quoted names and leaves unrelated tables writable", () => {
    registerProtectedMutationTables({
      tables: ["documents"],
      guidance: "Use update-document.",
    });

    expect(() => assertMutationTableIsNotProtected('"documents"')).toThrow(
      /update-document/,
    );
    expect(() =>
      assertSqlDoesNotMutateProtectedTable(
        "UPDATE application_state SET value = ? WHERE key = ?",
      ),
    ).not.toThrow();
  });

  it("finds protected writes inside CTEs without matching comments or values", () => {
    registerProtectedMutationTables({
      tables: ["documents"],
      guidance: "Use update-document.",
    });

    expect(() =>
      assertSqlDoesNotMutateProtectedTable(
        "WITH chosen AS (SELECT 'UPDATE documents SET title = 1' AS note) UPDATE \"documents\" SET title = ? WHERE id = ?",
      ),
    ).toThrow(/protected/i);
    expect(() =>
      assertSqlDoesNotMutateProtectedTable(
        "UPDATE notes SET body = 'UPDATE documents SET title = 1' WHERE id = ? -- DELETE FROM documents",
      ),
    ).not.toThrow();
  });

  it("allows unregistering an app manifest", () => {
    const unregister = registerProtectedMutationTables({
      tables: ["documents"],
      guidance: "Use update-document.",
    });
    unregister();

    expect(() => assertMutationTableIsNotProtected("documents")).not.toThrow();
  });
});
