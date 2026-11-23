import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import type { CellDraft } from "../app/lib/model/contracts.js";
import { restoreNotebookMembership } from "../shared/notebook-sections.js";

const mocks = vi.hoisted(() => ({ read: vi.fn(), access: vi.fn() }));
vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: mocks.access,
}));
vi.mock("../server/model/projects-store.js", () => ({
  getReadableProjectDocument: mocks.read,
}));
import exportProject from "./export-project-yaml.js";

describe("A2-PROJECT-MENU-CONTROLS YAML export", () => {
  it("exports ordered saved cell sources as valid create-project input without outputs", async () => {
    mocks.access.mockResolvedValue({
      scope: { ownerEmail: "qa@example.test", orgId: "org" },
    });
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    mocks.read.mockResolvedValue({
      title: "Report / Q1",
      language: "python",
      description: "Summary",
      cells: [
        {
          contents: {
            ...base,
            id: "b",
            order: "b",
            kind: "markdown",
            markdown: "# Findings",
          },
        },
        {
          contents: {
            ...base,
            id: "a",
            order: "a",
            kind: "sql",
            source: "select 1",
            dataConnectionId: null,
            databaseSchema: null,
            resultVariable: null,
            outputResult: true,
            pendingEdit: {
              id: "draft",
              baseSource: "select 1",
              source: "select private",
            },
          },
        },
      ],
      outputs: { private: "never export" },
    });
    const result = await exportProject.run({ projectId: "p" }, {} as never);
    const value = parse(result.content);
    expect(value).toEqual(
      expect.objectContaining({ title: "Report / Q1", description: "Summary" }),
    );
    expect(value.cells.map((cell: { kind: string }) => cell.kind)).toEqual([
      "sql",
      "markdown",
    ]);
    expect(result.content).not.toContain("never export");
    expect(result.content).not.toContain("select private");
    expect(result.filename).toBe("Report-Q1.yaml");
  });
});

it("rejects a format the current create action cannot restore", async () => {
  mocks.access.mockResolvedValue({
    scope: { ownerEmail: "qa@example.test", orgId: "org" },
  });
  mocks.read.mockResolvedValue({
    title: "R project",
    language: "r",
    description: "",
    cells: [],
  });
  await expect(
    exportProject.run({ projectId: "r" }, {} as never),
  ).rejects.toThrow("cannot be exported");
});

it("includes the Section identifiers needed to restore nested membership", async () => {
  mocks.access.mockResolvedValue({
    scope: { ownerEmail: "qa@example.test", orgId: "org" },
  });
  const base = {
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
  };
  mocks.read.mockResolvedValue({
    title: "Nested analysis",
    language: "python",
    description: "",
    cells: [
      {
        contents: {
          ...base,
          kind: "collapsible",
          id: "outer",
          order: "a",
          title: "Outer",
          collapsed: true,
        },
      },
      {
        contents: {
          ...base,
          kind: "collapsible",
          id: "inner",
          order: "b",
          title: "Inner",
          collapsed: false,
          parentSectionId: "outer",
        },
      },
      {
        contents: {
          ...base,
          kind: "text",
          id: "detail",
          order: "c",
          text: "Detail",
          parentSectionId: "inner",
        },
      },
    ],
  });
  const { content } = await exportProject.run({ projectId: "p" }, {} as never);
  const exported = parse(content) as { cells: CellDraft[] };
  expect(exported).toMatchObject({
    cells: [
      { id: "outer", kind: "collapsible", collapsed: true },
      { id: "inner", kind: "collapsible", parentSectionId: "outer" },
      { kind: "text", parentSectionId: "inner" },
    ],
  });
  let index = 0;
  expect(
    restoreNotebookMembership(exported.cells, () => `new-${++index}`),
  ).toMatchObject([
    { id: "new-1", kind: "collapsible", collapsed: true },
    { id: "new-2", kind: "collapsible", parentSectionId: "new-1" },
    { id: "new-3", kind: "text", parentSectionId: "new-2" },
  ]);
});
