import { describe, expect, it } from "vitest";

import {
  notebookIpynbBase64,
  notebookIpynbFilename,
  notebookToIpynb,
} from "./notebook-ipynb.js";

describe("notebookToIpynb", () => {
  it("maps markdown, text and code cells in order", () => {
    const out = notebookToIpynb({
      title: "Quarterly Review",
      language: "python",
      cells: [
        { kind: "markdown", contents: "# Title" },
        { kind: "text", contents: "plain note" },
        { kind: "code", contents: "print(1)" },
      ],
    });
    const doc = JSON.parse(out.content);
    expect(out.filename).toBe("quarterly-review.ipynb");
    expect(out.skippedCells).toBe(0);
    expect(doc.nbformat).toBe(4);
    expect(doc.nbformat_minor).toBe(5);
    expect(doc.metadata.language_info.name).toBe("python");
    expect(doc.metadata.kernelspec.name).toBe("python3");
    expect(doc.cells.map((cell: any) => cell.cell_type)).toEqual([
      "markdown",
      "markdown",
      "code",
    ]);
    expect(doc.cells[0].source).toEqual(["# Title"]);
    expect(doc.cells[1].source).toEqual(["plain note"]);
    expect(doc.cells[2].source).toEqual(["print(1)"]);
    expect(doc.cells[2].execution_count).toBeNull();
    expect(doc.cells[2].outputs).toEqual([]);
  });

  it("keeps R metadata for R projects", () => {
    const doc = JSON.parse(
      notebookToIpynb({ title: "R", language: "r", cells: [] }).content,
    );
    expect(doc.metadata.language_info.name).toBe("r");
    expect(doc.metadata.kernelspec.name).toBe("ir");
  });

  it("counts unsupported cells instead of guessing", () => {
    const out = notebookToIpynb({
      title: "Mixed",
      language: "python",
      cells: [
        { kind: "sql", contents: "select 1" },
        { kind: "chart", contents: "{}" },
        { kind: "code", contents: "x = 1" },
      ],
    });
    expect(out.skippedCells).toBe(2);
    expect(JSON.parse(out.content).cells).toHaveLength(1);
  });

  it("is deterministic and round-trips escaping", () => {
    const input = {
      title: "Escapes",
      language: "python",
      cells: [
        { kind: "code" as const, contents: 'print("</script> ${x} \u2028")' },
      ],
    };
    const first = notebookToIpynb(input);
    const second = notebookToIpynb(input);
    expect(first.content).toBe(second.content);
    expect(JSON.parse(first.content).cells[0].source).toEqual([
      'print("</script> ${x} \u2028")',
    ]);
  });

  it("produces a safe filename and base64 content", () => {
    expect(notebookIpynbFilename("  ../My Project  ")).toBe("my-project.ipynb");
    expect(notebookIpynbFilename("")).toBe("project.ipynb");
    const encoded = notebookIpynbBase64({
      title: "Base64",
      language: "python",
      cells: [],
    });
    expect(encoded.content).toBe(
      Buffer.from(
        Buffer.from(encoded.content, "base64").toString("utf8"),
        "utf8",
      ).toString("base64"),
    );
    expect(encoded.filename.endsWith(".ipynb")).toBe(true);
  });
});
