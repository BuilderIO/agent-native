import { describe, expect, it } from "vitest";

import { parseIpynbProject } from "./notebook-ipynb-import";

const notebook = (cells: unknown[], title?: string) =>
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: title ? { title } : {},
    cells,
  });

describe("parseIpynbProject", () => {
  it("maps code and markdown cells in order and keeps the notebook title", () => {
    const result = parseIpynbProject(
      notebook(
        [
          { cell_type: "markdown", source: ["# Report\n", "Intro"] },
          { cell_type: "code", source: ["select 1\n"], outputs: [] },
          { cell_type: "raw", source: "ignored" },
          { cell_type: "code", source: "   " },
        ],
        "Quarterly review",
      ),
    );
    expect(result.title).toBe("Quarterly review");
    expect(result.cells).toEqual([
      { kind: "markdown", markdown: "# Report\nIntro" },
      { kind: "code", language: "python", source: "select 1\n" },
    ]);
  });

  it("rejects non-notebook and unsupported-format files", () => {
    expect(() => parseIpynbProject("not json")).toThrow(
      "not a valid Jupyter notebook",
    );
    expect(() =>
      parseIpynbProject(JSON.stringify({ nbformat: 3, cells: [] })),
    ).toThrow("Only Jupyter notebook format 4");
  });
});
