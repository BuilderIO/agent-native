import { getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { describe, expect, it } from "vitest";

describe("the database a spec reaches by default", () => {
  // `data/pglite` is the dev server's live database. A spec with no database of
  // its own (the default tripwire recorder, an action that calls `getDb()`) must
  // open memory instead; vitest.config.ts sets the URL that makes it so.
  it("is in memory, not the dev server's data directory", () => {
    expect(getRuntimeDatabaseUrl("pglite:./data/pglite")).toBe("pglite:memory");
  });
});
