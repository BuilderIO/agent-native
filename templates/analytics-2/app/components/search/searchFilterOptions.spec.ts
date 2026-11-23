import { expect, it } from "vitest";

import { toSearchFilterOptions } from "./searchFilterOptions";

it("addresses creators by member email so the creator filter matches a project owner", () => {
  const options = toSearchFilterOptions({
    members: [{ email: "ana@example.test" }, { email: "ben@example.test" }],
  });
  expect(options.creators).toEqual([
    { id: "ana@example.test", label: "ana@example.test" },
    { id: "ben@example.test", label: "ben@example.test" },
  ]);
});

it("shows a creator by full name and falls back to the email without one", () => {
  const options = toSearchFilterOptions({
    members: [
      { email: "ana@example.test", name: "Ana Reyes" },
      { email: "ben@example.test", name: "  " },
    ],
  });
  expect(options.creators).toEqual([
    { id: "ana@example.test", label: "Ana Reyes" },
    { id: "ben@example.test", label: "ben@example.test" },
  ]);
});

it("labels the workspace's categories and statuses with their own names", () => {
  const options = toSearchFilterOptions({
    categories: [{ id: "cat-1", name: "Finance" }],
    statuses: [{ id: "status-1", name: "Endorsed" }],
  });
  expect(options.categories).toEqual([{ id: "cat-1", label: "Finance" }]);
  expect(options.statuses).toEqual([{ id: "status-1", label: "Endorsed" }]);
});

it("never invents an option from a row without an id or a name", () => {
  const options = toSearchFilterOptions({
    members: [{ email: "" }, { email: null }],
    categories: [
      { id: "cat-1", name: null },
      { id: null, name: "Finance" },
    ],
    statuses: [{ id: "", name: "" }],
  });
  expect(options).toEqual({});
});

it("answers with real empty lists when a catalogue is empty", () => {
  expect(toSearchFilterOptions({ members: [], categories: [] })).toEqual({});
});
