import { describe, expect, it, vi } from "vitest";

const table = (rows: number) => ({
  type: "table" as const,
  columns: [{ name: "day", type: "string" as const }],
  rows: Array.from({ length: rows }, (_, i) => [`d${i}`]),
  rowCount: rows,
  truncated: false,
});

vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: async () => ({
    scope: { orgId: "org-1", ownerEmail: "qa@example.com" },
    project: { id: "p" },
  }),
}));

vi.mock("../server/model/projects-store.js", () => ({
  getReadableProjectDocument: async () => ({
    id: "p",
    title: "V3",
    ownerEmail: "qa@example.com",
    cells: [
      { id: "a", contents: { kind: "sql", title: "Users" } },
      { id: "b", contents: { kind: "sql", title: "Never run" } },
      { id: "c", contents: { kind: "sql", title: "Broken" } },
    ],
  }),
}));

vi.mock("../server/model/project-output-access.js", () => ({
  readAccessibleProjectOutputs: async () => ({
    a: { cellId: "a", status: "complete", output: table(30), ranAt: "t" },
    c: {
      cellId: "c",
      status: "error",
      output: { type: "error", message: "boom", detail: null },
      ranAt: "t",
    },
  }),
}));

vi.mock("../server/model/seed.js", () => ({
  readSeededSampleCell: (_scope: unknown, cell: unknown, output: unknown) => ({
    cell,
    output,
  }),
}));

import summary from "./get-project-summary.js";

describe("get-project-summary", () => {
  it("caps rows, skips cells with no saved output and keeps errors", async () => {
    const result = await summary.run({ projectId: "p" }, undefined as never);
    expect(result.cells.map((c) => c.cellId)).toEqual(["a", "c"]);
    expect(result.cells[0].rows).toHaveLength(6);
    expect(result.cells[0].totalRows).toBe("30");
    expect(result.cells[1].error).toBe("boom");
    expect(result.partial).toBe(true);
  });
});
