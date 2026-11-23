import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CellOutput } from "../app/lib/model/contracts.js";

const { runQuery, readProject } = vi.hoisted(() => ({
  runQuery: vi.fn(),
  readProject: vi.fn(),
}));
vi.mock("../server/model/project-query.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/model/project-query.js")
  >()),
  runProjectQuery: runQuery,
}));
vi.mock("./get-project.js", () => ({ default: { run: readProject } }));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: vi.fn().mockResolvedValue({
    ownerEmail: "reader@example.test",
    orgId: "result-shape-workspace",
  }),
}));
vi.mock("../server/model/dataframe-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/model/dataframe-lifecycle.js")
  >()),
  sweepDataframeBlobsAfterWrite: vi.fn().mockResolvedValue(undefined),
}));

import getResults from "./get-project-cell-results.js";
import runCell from "./run-project-cell.js";

const cell = { projectId: "project", cellId: "cell" };
const firstPage = { ...cell, offset: 0, limit: 50 };
const toolContext = { caller: "tool" } as const;
const project = { cells: [{ id: cell.cellId }] };
const output = {
  type: "table" as const,
  columns: [{ name: "value", type: "number" as const }],
  rows: Array.from({ length: 270 }, (_, value) => [value]),
  rowCount: 270,
  truncated: false,
};

function completedProject(output: CellOutput) {
  return {
    project,
    outputs: { cell: { status: "complete", output } },
    queryStates: {},
  };
}

describe("report SAYA-1117-RESULT-SHAPE", () => {
  beforeEach(() => {
    runQuery.mockResolvedValue({
      status: "complete",
      output,
      hasNextPage: false,
      totalRows: "270",
    });
    readProject.mockResolvedValue(completedProject(output));
  });

  it("returns a bounded, typed preview with total and pageable stored rows, while preserving the frontend result", async () => {
    const agent = await getResults.run(firstPage, toolContext);
    expect(agent.status).toBe("complete");
    expect(agent.totalRows).toBe("270");
    expect(agent.offset).toBe(0);
    expect(agent.nextOffset).toBe(50);
    expect(agent.output?.type).toBe("table");
    if (agent.output?.type !== "table") throw new Error("Missing table");
    expect(agent.output.columns).toEqual([{ name: "value", type: "number" }]);
    expect(agent.output.rows).toHaveLength(50);
    expect(agent.output.rows[0]).toEqual([0]);
    expect(agent.output.rowCount).toBe(270);
    expect(agent.output.truncated).toBe(true);
    expect((await runCell.run(cell, { caller: "frontend" })).output).toEqual(
      output,
    );
    const page = await getResults.run(
      { ...firstPage, offset: 250 },
      toolContext,
    );
    expect(page).toMatchObject({
      status: "complete",
      totalRows: "270",
      offset: 250,
      nextOffset: null,
    });
    expect(page.output?.type === "table" && page.output.rows).toEqual(
      output.rows.slice(250),
    );
  });

  it("keeps running status distinct from old results and bounds long values", async () => {
    readProject.mockResolvedValueOnce({
      project,
      outputs: {
        cell: {
          status: "error",
          output: { type: "error", message: "old failure", detail: null },
        },
      },
      queryStates: {
        cell: { status: "running", totalRows: null, hasNextPage: false },
      },
    });
    expect(await getResults.run(firstPage, toolContext)).toMatchObject({
      status: "running",
      totalRows: null,
      output: null,
    });
    readProject.mockResolvedValueOnce(
      completedProject({
        ...output,
        columns: [{ name: "text", type: "string" }],
        rows: [["x".repeat(100_000)]],
        rowCount: 1,
      }),
    );
    const result = await getResults.run(firstPage, toolContext);
    expect(JSON.stringify(result).length).toBeLessThan(5000);
    expect(result.preview?.valuesTruncated).toBe(true);
    expect(result.output?.type === "table" && result.output.rows).toEqual([
      ["x".repeat(2000)],
    ]);
  });
  it("never truncates a numeric string into a different value", async () => {
    readProject.mockResolvedValueOnce(
      completedProject({ ...output, rows: [["9".repeat(2001)]], rowCount: 1 }),
    );
    await expect(getResults.run(firstPage, toolContext)).rejects.toMatchObject({
      errorCode: "cell_output_value_too_large",
    });
  });
  it("reports an unavailable result when a completed run has no saved output", async () => {
    readProject.mockResolvedValueOnce({
      project,
      outputs: {},
      queryStates: {
        cell: { status: "complete", totalRows: "270", hasNextPage: false },
      },
    });
    expect(await getResults.run(firstPage, toolContext)).toMatchObject({
      status: "unavailable",
      output: null,
      totalRows: "270",
    });
  });
});
