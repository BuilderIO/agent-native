import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findHardDeletes,
  isHardDeleteScopePath,
} from "./guard-no-new-hard-delete.js";

const FILE = "templates/slides/actions/delete-deck.ts";

function flaggedLines(source: string, added?: Set<number>) {
  const lines = added ?? new Set(source.split("\n").map((_, i) => i + 1));
  return findHardDeletes(FILE, source, lines).map((finding) => finding.line);
}

describe("no new hard delete guard", () => {
  it("flags Drizzle deletes on db handles and DELETE FROM SQL", () => {
    const source = [
      "await db.delete(schema.decks).where(eq(schema.decks.id, id));",
      "await tx",
      "  .delete(schema.slideComments)",
      "  .where(eq(schema.slideComments.deckId, id));",
      "await getDb().delete(schema.assets);",
      "await exec.execute({ sql: `DELETE FROM decks WHERE id = ${id}` });",
      "await transaction.delete(schema.documents);",
      "await getDatabase().delete(schema.runs);",
      "seen.delete(id);",
      "url.searchParams.delete('tab');",
      "await db.update(schema.decks).set({ deletedAt: now });",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [1, 3, 5, 6, 7, 8]);
  });

  it("only reports deletes on lines this branch added", () => {
    const source = [
      "await db.delete(schema.old);",
      "await tx",
      "  .delete(schema.fresh);",
    ].join("\n");

    assert.deepEqual(flaggedLines(source, new Set([3])), [3]);
    assert.deepEqual(flaggedLines(source, new Set([2])), []);
  });

  it("honors the opt-out on the statement or the line above it", () => {
    const source = [
      "// guard:allow-hard-delete — purge of an already-deleted deck",
      "await tx",
      "  .delete(schema.decks)",
      "  .where(eq(schema.decks.id, id));",
      "await db.delete(schema.sessions); // guard:allow-hard-delete — ephemeral",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), []);
  });

  it("does not let a pragma elsewhere in an action exempt an arrow-body delete", () => {
    const source = [
      "export default defineAction({",
      "  // guard:allow-hard-delete — purge helper below",
      "  purge: async () => { await db.delete(schema.old); },",
      "  run: async ({ id }) =>",
      "    db.delete(schema.decks).where(eq(schema.decks.id, id)),",
      "});",
    ].join("\n");

    assert.deepEqual(flaggedLines(source), [5]);
  });

  it("scopes to app actions/server code, not core or tests", () => {
    assert.equal(isHardDeleteScopePath(FILE), true);
    assert.equal(
      isHardDeleteScopePath("templates/tasks/server/tasks/store.ts"),
      true,
    );
    assert.equal(
      isHardDeleteScopePath("packages/core/src/chat-threads/store.ts"),
      false,
    );
    assert.equal(
      isHardDeleteScopePath("templates/slides/actions/delete-deck.test.ts"),
      false,
    );
    assert.equal(isHardDeleteScopePath("templates/slides/app/x.tsx"), false);
  });
});
