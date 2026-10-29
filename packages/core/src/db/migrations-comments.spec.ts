import { expect, it } from "vitest";

import { splitSqlStatements } from "./migrations.js";

it("preserves legacy output for comments in existing migrations", () => {
  expect(
    splitSqlStatements("SELECT 1 -- comment\nFROM t; /* note */ SELECT 2;"),
  ).toEqual(["SELECT 1 \nFROM t", "/* note */ SELECT 2"]);
  expect(splitSqlStatements("SELECT 1 -- comment\r\nFROM t;")).toEqual([
    "SELECT 1 \nFROM t",
  ]);
});
