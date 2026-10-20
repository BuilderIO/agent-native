import { describe, expect, it } from "vitest";

import {
  DEFAULT_ITEMS_FILTERS,
  clearNarrowingFilters,
  hasNarrowingFilters,
  itemsQueryParams,
  parseItemsScope,
} from "./items-query";

describe("itemsQueryParams", () => {
  it("opens on the items that need a person", () => {
    expect(itemsQueryParams("f1", DEFAULT_ITEMS_FILTERS)).toEqual({
      factoryId: "f1",
      limit: 25,
      needsYou: true,
    });
  });

  it("maps each segment to its own filter and never two at once", () => {
    const base = DEFAULT_ITEMS_FILTERS;
    expect(itemsQueryParams("f1", { ...base, scope: "parked" })).toMatchObject({
      parked: true,
    });
    expect(
      itemsQueryParams("f1", { ...base, scope: "parked" }),
    ).not.toHaveProperty("needsYou");
    expect(
      itemsQueryParams("f1", { ...base, scope: "dismissed" }),
    ).toMatchObject({
      status: ["dismissed"],
    });
    const all = itemsQueryParams("f1", { ...base, scope: "all" });
    expect(all).not.toHaveProperty("needsYou");
    expect(all).not.toHaveProperty("parked");
    expect(all).not.toHaveProperty("status");
  });

  it("sends the narrowing filters only when set, with a trimmed and bounded search", () => {
    const params = itemsQueryParams("f1", {
      scope: "all",
      workflowId: "wf1",
      source: "slack",
      search: `  ${"x".repeat(150)}  `,
    });
    expect(params).toMatchObject({ workflowId: "wf1", source: "slack" });
    expect((params.search as string).length).toBe(100);
    expect(
      itemsQueryParams("f1", {
        scope: "all",
        workflowId: null,
        source: null,
        search: "   ",
      }),
    ).not.toHaveProperty("search");
  });
});

describe("narrowing filters", () => {
  it("tells a filtered empty list from an empty segment", () => {
    expect(hasNarrowingFilters(DEFAULT_ITEMS_FILTERS)).toBe(false);
    expect(
      hasNarrowingFilters({ ...DEFAULT_ITEMS_FILTERS, source: "slack" }),
    ).toBe(true);
    expect(hasNarrowingFilters({ ...DEFAULT_ITEMS_FILTERS, search: " " })).toBe(
      false,
    );
  });

  it("clears them but keeps the segment", () => {
    expect(
      clearNarrowingFilters({
        scope: "parked",
        workflowId: "wf1",
        source: "slack",
        search: "export",
      }),
    ).toEqual({ scope: "parked", workflowId: null, source: null, search: "" });
  });

  it("parses a segment value and refuses an unknown one", () => {
    expect(parseItemsScope("parked")).toBe("parked");
    expect(parseItemsScope("")).toBeNull();
    expect(parseItemsScope("done")).toBeNull();
  });
});
