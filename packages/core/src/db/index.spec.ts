import { describe, expect, it } from "vitest";

import { sql, type SqlFragment } from "./index.js";

describe("database exports", () => {
  it("exports typed SQL fragments from the database entry point", () => {
    const fragment: SqlFragment = sql`SELECT ${sql.value("thread-1")}`;

    expect(fragment.sql).toBe("SELECT ?");
    expect(fragment.args).toEqual(["thread-1"]);
  });
});
