import { expect, it } from "vitest";

import instructions from "./workspace.md?raw";

it("tells the agent to chart real tables, not literal values", () => {
  expect(instructions).toMatch(/query the real tables/i);
  expect(instructions).toMatch(/Never hard-code literal rows or values/);
});

it("authorizes read-only SELECTs and rejects first-N previews as evidence", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f: string) =>
    readFileSync(new URL(`../actions/${f}`, import.meta.url), "utf8");
  expect(instructions).toMatch(/do not ask permission again/);
  expect(instructions).toMatch(
    /first-N preview is not a representative sample/,
  );
  expect(read("add-project-cell.ts")).toMatch(/without asking permission/);
  expect(read("run-project-cell.ts")).toMatch(/do not ask permission/);
  expect(read("start-notebook-run.ts")).toMatch(/without asking permission/);
  expect(read("run-organization-warehouse-query.ts")).toMatch(
    /without asking permission/,
  );
  expect(read("run-project-cell.ts")).toMatch(/not representative/);
  expect(read("get-notebook-result-page.ts")).toMatch(
    /not a representative sample/,
  );
  expect(read("get-project-cell-results.ts")).toMatch(
    /not a representative sample/,
  );
});

it("report SAYA-1117: aligns workspace instructions with thread run readback and disabled app DB tools", () => {
  expect(instructions).not.toMatch(
    /Use `db-query` only for application database reads/,
  );
  expect(instructions).toMatch(
    /get-notebook-run[\s\S]*get-notebook-result-page/,
  );
});
