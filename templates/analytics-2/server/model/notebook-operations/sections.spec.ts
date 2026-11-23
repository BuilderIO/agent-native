import { describe, expect, it } from "vitest";

import {
  applyAppPatches,
  draftAppLayout,
  projectAppLayout,
} from "../../../shared/app-layout.js";
import {
  notebookCellSchema,
  notebookCommandSchema,
  revisionSchema,
} from "../../../shared/notebook-operations.js";
import { planNotebookCommand, type NotebookState } from "./commands.js";
import { isUndoable, resourceRevisions } from "./undo-plan.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const revision = revisionSchema.parse("1");
const nextRevision = revisionSchema.parse("2");
const resources = {
  orderRevision: revision,
  metadataRevision: revision,
  inputRevision: revision,
  layoutRevision: revision,
};

function cell(
  id: string,
  order: string,
  section = false,
  parentSectionId?: string,
) {
  return notebookCellSchema.parse({
    id,
    projectId: "prj_sections",
    versionId: "version",
    contents: {
      id,
      order,
      ...(parentSectionId === undefined ? {} : { parentSectionId }),
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      ...(section
        ? { kind: "collapsible", title: null, collapsed: true }
        : { kind: "text", text: id }),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    revision,
    labelRevision: revision,
  });
}

function execute(cells: NotebookState["cells"], ...changes: unknown[]) {
  const command = notebookCommandSchema.parse({
    protocol: 1,
    projectId: "prj_sections",
    workingVersionId: "version",
    opId: "section-change",
    observedHead: { versionId: "version", revision },
    changes,
  });
  const state = {
    metadata: { title: "Sections", description: "", statusId: null },
    resources,
    cells,
    appLayout: applyAppPatches(
      draftAppLayout(cells, revision),
      [{ type: "initialize" }],
      cells,
    ),
    tombstones: new Map(),
  };
  return {
    plan: planNotebookCommand(command, state, nextRevision, timestamp),
    command,
    state,
  };
}

function placements(cells: NotebookState["cells"]) {
  return cells.map(({ id, contents }) => [
    id,
    "parentSectionId" in contents ? (contents.parentSectionId ?? null) : null,
  ]);
}

describe("Section commands", () => {
  it("groups a noncontiguous selection, preserves IDs and independent app placements, and undoes it", () => {
    const cells = [cell("a", "a"), cell("b", "b"), cell("c", "c")];
    const { plan, command, state } = execute(cells, {
      type: "group-section",
      cellId: "section",
      cellIds: ["c", "a"],
      expectedOrderRevision: revision,
    });
    expect(placements(plan.cells)).toEqual([
      ["section", null],
      ["a", "section"],
      ["c", "section"],
      ["b", null],
    ]);
    expect(plan.orderChanged).toBe(true);
    expect(plan.invalidatedCellIds).toEqual([]);
    expect(plan.layoutChanged).toBe(false);
    const layout = state.appLayout;
    expect(
      projectAppLayout(layout).rows.flatMap(({ columns }) =>
        columns.flatMap(({ elements }) => elements.map(({ cellId }) => cellId)),
      ),
    ).toEqual(["a", "b", "c"]);
    const before = { cells, resources, tombstones: [] };
    const after = {
      cells: plan.cells.filter(({ id }) => id !== "b"),
      resources: { ...resources, orderRevision: nextRevision },
      tombstones: [],
    };
    const inverse = {
      before: { ...before, cells: cells.filter(({ id }) => id !== "b") },
      after,
    };
    expect(isUndoable(inverse)).toBe(true);
    const undo = planNotebookCommand(
      { ...command, changes: [] },
      {
        ...state,
        cells: plan.cells,
        resources: after.resources,
        appLayout: layout,
      },
      revisionSchema.parse("3"),
      timestamp,
      {
        plan: inverse,
        currentRevisions: resourceRevisions(after),
        equivalent: (_key, value) => value,
      },
    );
    expect(placements(undo.cells)).toEqual([
      ["a", null],
      ["b", null],
      ["c", null],
    ]);
  });

  it("moves into a collapsed Section and rejects cycles, excessive depth, and stale revisions", () => {
    const cells = [
      cell("outer", "a", true),
      cell("inner", "b", true, "outer"),
      cell("leaf", "c", true, "inner"),
      cell("text", "d"),
    ];
    const move = {
      type: "move-to-section",
      cellId: "text",
      cellIds: ["text"],
      parentSectionId: "outer",
      expectedOrderRevision: revision,
    };
    const { plan } = execute(cells, move);
    expect(placements(plan.cells)).toEqual([
      ["outer", null],
      ["inner", "outer"],
      ["leaf", "inner"],
      ["text", "outer"],
    ]);
    expect(plan.cells[0]?.contents).toMatchObject({ collapsed: false });
    expect(plan.orderChanged).toBe(true);
    expect(() =>
      execute(cells, {
        ...move,
        cellId: "outer",
        cellIds: ["outer"],
        parentSectionId: "leaf",
      }),
    ).toThrow("notebook_invalid_change");
    expect(() =>
      execute(cells, {
        ...move,
        cellId: "inner",
        cellIds: ["inner"],
        parentSectionId: "leaf",
      }),
    ).toThrow("notebook_invalid_change");
    expect(() =>
      execute([...cells, cell("fourth", "e", true)], {
        ...move,
        cellId: "fourth",
        cellIds: ["fourth"],
        parentSectionId: "leaf",
      }),
    ).toThrow("notebook_invalid_change");
    expect(() =>
      execute(cells, { ...move, expectedOrderRevision: "0" }),
    ).toThrow("order_changed");
    const out = execute(plan.cells, {
      ...move,
      parentSectionId: null,
      beforeCellId: "outer",
    });
    expect(placements(out.plan.cells)).toEqual([
      ["text", null],
      ["outer", null],
      ["inner", "outer"],
      ["leaf", "inner"],
    ]);
  });

  it("ejects immediate children and requires an explicit recursive deletion", () => {
    const cells = [
      cell("outer", "a", true),
      cell("inner", "b", true, "outer"),
      cell("text", "c", false, "inner"),
      cell("unrelated", "d"),
    ];
    const remove = {
      type: "remove-section",
      cellId: "outer",
      expectedOrderRevision: revision,
    };
    expect(
      placements(execute(cells, { ...remove, mode: "eject" }).plan.cells),
    ).toEqual([
      ["inner", null],
      ["text", "inner"],
      ["unrelated", null],
    ]);
    expect(
      placements(execute(cells, { ...remove, mode: "delete" }).plan.cells),
    ).toEqual([["unrelated", null]]);
    expect(() =>
      execute(cells, { ...remove, type: "delete", expectedRevision: revision }),
    ).toThrow("notebook_invalid_change");
  });
});
