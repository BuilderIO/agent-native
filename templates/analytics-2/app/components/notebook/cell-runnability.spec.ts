import { describe, expect, it } from "vitest";

import { CELL_KINDS } from "@/lib/model/cell-types";

import { cellIsRunnable, cellUsesConnection } from "./utils";

describe("which cells may offer Run", () => {
  it("offers Run on a SQL cell", () => {
    expect(cellIsRunnable({ kind: "sql" })).toBe(true);
    expect(cellUsesConnection("sql")).toBe(true);
  });

  it("offers Run on Python without requiring a warehouse connection", () => {
    expect(cellIsRunnable({ kind: "code", language: "python" })).toBe(true);
    expect(cellUsesConnection("code")).toBe(false);
  });

  it("does not offer Run on an imported R cell", () => {
    expect(cellIsRunnable({ kind: "code", language: "r" })).toBe(false);
  });

  it("does not offer Run on any other cell kind the runner cannot execute", () => {
    for (const kind of CELL_KINDS.filter((kind) => kind !== "sql")) {
      expect(cellIsRunnable({ kind }), kind).toBe(false);
    }
  });
});
