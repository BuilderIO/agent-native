import { expect, it } from "vitest";

import {
  cellSchema,
  type ProjectDocument,
} from "../app/lib/model/contracts.js";
import { linkedInputRange, rangePresetUpdates } from "./input-range.js";
import {
  appViewerCellIds,
  appViewerDocument,
} from "./published-app-projection.js";

const cell = (id: string, name: string, hidden: boolean) =>
  cellSchema.parse({
    id,
    projectId: "project",
    versionId: "release",
    createdAt: "2026-11-01",
    updatedAt: "2026-11-01",
    contents: {
      id,
      order: "a1",
      label: null,
      hidden,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "input",
      name,
      inputType: "DATE",
      defaultValueString: "2026-11-01",
    },
  });
const parent = cellSchema.parse({
  ...cell("period", "period", false),
  contents: {
    ...cell("period", "period", false).contents,
    inputType: "DROPDOWN",
    options: ["30d", "custom"],
    defaultValueString: "30d",
    rangeInputs: { start: "begin", end: "finish" },
  },
});
const start = cell("first", "begin", true);
const end = cell("last", "finish", true);
const unrelated = cell("private", "private", true);

it("preserves declared links and exposes only their inputs to an app viewer", () => {
  const project = { cells: [parent, start, end, unrelated] } as ProjectDocument;
  expect(linkedInputRange(project.cells, parent)).toEqual({ start, end });
  const visible = appViewerCellIds(project);
  expect(visible).toEqual(new Set([parent.id, start.id, end.id]));
  expect(appViewerDocument(project, visible).cells.map(({ id }) => id)).toEqual(
    [parent.id, start.id, end.id],
  );
});

it("refuses missing or ambiguous date input links", () => {
  expect(linkedInputRange([parent, start], parent)).toBeNull();
  expect(
    linkedInputRange(
      [parent, start, end, cell("duplicate", "begin", true)],
      parent,
    ),
  ).toBeNull();
});

it("initializes neutral date bounds with a recent range in the same preset update", () => {
  const configured = cellSchema.parse({
    ...parent,
    contents: {
      ...parent.contents,
      rangeInputs: { start: "begin", end: "finish", initialDays: 30 },
    },
  });
  expect(
    rangePresetUpdates(
      configured,
      { start, end },
      "custom",
      {},
      new Date("2026-11-21T12:00:00Z"),
    ),
  ).toEqual([
    { cell: configured, value: "custom" },
    { cell: start, value: "2026-10-22" },
    { cell: end, value: "2026-11-21" },
  ]);
});

it("retains an edited range and restores neutral bounds when returning to a preset", () => {
  const configured = cellSchema.parse({
    ...parent,
    contents: {
      ...parent.contents,
      rangeInputs: { start: "begin", end: "finish", initialDays: 30 },
    },
  });
  const values = { first: "2026-10-03", last: "2026-10-07" };
  expect(
    rangePresetUpdates(configured, { start, end }, "custom", values),
  ).toEqual([{ cell: configured, value: "custom" }]);
  expect(rangePresetUpdates(configured, { start, end }, "30d", values)).toEqual(
    [
      { cell: configured, value: "30d" },
      { cell: start, value: "2026-11-01" },
      { cell: end, value: "2026-11-01" },
    ],
  );
});

it("initializes across a leap-day boundary using calendar dates", () => {
  const configured = cellSchema.parse({
    ...parent,
    contents: {
      ...parent.contents,
      rangeInputs: { start: "begin", end: "finish", initialDays: 1 },
    },
  });
  expect(
    rangePresetUpdates(
      configured,
      { start, end },
      "custom",
      {},
      new Date("2024-03-01T12:00:00Z"),
    ),
  ).toEqual([
    { cell: configured, value: "custom" },
    { cell: start, value: "2024-02-29" },
    { cell: end, value: "2024-03-01" },
  ]);
});
