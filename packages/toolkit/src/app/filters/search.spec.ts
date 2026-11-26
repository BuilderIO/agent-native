import { describe, expect, it } from "vitest";

import { FILTER_NOBODY, type FilterField } from "./model.js";
import {
  filterValueCandidates,
  matchesFilterQuery,
  searchFilterFields,
  type FilterCandidateLabels,
} from "./search.js";

const labels: FilterCandidateLabels = {
  nobody: "Nobody",
  checked: () => "Yes",
  unchecked: () => "No",
  datePreset: (operator, value) => `${operator} ${value}`,
};

const sourceField: FilterField = {
  id: "source",
  label: "Where it came from",
  type: "choice",
  options: [{ id: "content", label: "Uploaded from Content" }],
  pinned: { default: ["clips"] },
};

const ownerField: FilterField = {
  id: "owner",
  label: "Made by",
  type: "person",
  options: [
    { id: "alice", label: "Alice" },
    { id: "agent", label: "An agent" },
  ],
};

const statusField: FilterField = {
  id: "status",
  label: "Status",
  type: "choice",
  options: [
    { id: "ready", label: "Ready" },
    { id: "processing", label: "Processing" },
  ],
};

const titleField: FilterField = { id: "title", label: "Title", type: "text" };

const fields = [sourceField, ownerField, statusField, titleField];

describe("matchesFilterQuery", () => {
  it("needs every word somewhere in the label", () => {
    expect(matchesFilterQuery("Uploaded from Content", "content up")).toBe(
      true,
    );
    expect(matchesFilterQuery("Uploaded from Content", "content clips")).toBe(
      false,
    );
    expect(matchesFilterQuery("Anything", "   ")).toBe(true);
  });
});

describe("filterValueCandidates", () => {
  it("puts Nobody first for person fields", () => {
    expect(filterValueCandidates(ownerField, labels).at(0)).toEqual({
      value: [FILTER_NOBODY],
      operator: "equals",
      label: "Nobody",
    });
  });

  it("offers yes and no for a boolean field", () => {
    expect(
      filterValueCandidates(
        { id: "starred", label: "Starred", type: "boolean" },
        labels,
      ).map((candidate) => candidate.operator),
    ).toEqual(["is_checked", "is_unchecked"]);
  });

  it("offers nothing to pick for typed fields", () => {
    expect(filterValueCandidates(titleField, labels)).toEqual([]);
  });
});

describe("searchFilterFields", () => {
  it("lists every field but the pinned ones for an empty query", () => {
    expect(
      searchFilterFields(fields, "", labels).map((result) => result.field.id),
    ).toEqual(["owner", "status", "title"]);
  });

  it("puts field matches before value matches", () => {
    const results = searchFilterFields(fields, "a", labels);
    const kinds = results.map((result) => result.kind);
    expect(kinds.indexOf("value")).toBeGreaterThan(kinds.lastIndexOf("field"));
  });

  it("finds a value by its label", () => {
    const results = searchFilterFields(fields, "agent", labels);
    expect(results).toEqual([
      {
        kind: "value",
        field: ownerField,
        candidate: { value: ["agent"], operator: "equals", label: "An agent" },
      },
    ]);
  });

  it("matches a field and value together only for several words", () => {
    expect(searchFilterFields(fields, "status ready", labels)).toEqual([
      {
        kind: "value",
        field: statusField,
        candidate: { value: ["ready"], operator: "equals", label: "Ready" },
      },
    ]);
    expect(
      searchFilterFields(fields, "status", labels).map((result) => result.kind),
    ).toEqual(["field"]);
  });

  it("never offers values from a pinned field", () => {
    expect(searchFilterFields(fields, "uploaded", labels)).toEqual([]);
  });
});
