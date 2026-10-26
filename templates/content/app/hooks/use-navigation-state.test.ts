import { describe, expect, it } from "vitest";

import { navigationStateForLocation } from "./use-navigation-state";

function stateFor(path: string) {
  const url = new URL(path, "https://content.test");
  return navigationStateForLocation({
    pathname: url.pathname,
    searchParams: url.searchParams,
  });
}

describe("navigationStateForLocation", () => {
  it("tells the agent which Blocks field tab is open", () => {
    expect(stateFor("/page/doc-1?databaseId=db-1&field=notes")).toEqual({
      view: "editor",
      documentId: "doc-1",
      fieldId: "notes",
    });
  });

  it("leaves the field out when the first tab is open", () => {
    expect(stateFor("/page/doc-1")).toEqual({
      view: "editor",
      documentId: "doc-1",
    });
  });

  it("keeps the other views as they were", () => {
    expect(stateFor("/home")).toEqual({ view: "list" });
    expect(stateFor("/local-files?file=a.md")).toEqual({
      view: "local-files",
    });
    expect(stateFor("/abc123")).toEqual({
      view: "editor",
      documentId: "abc123",
    });
    expect(stateFor("/settings")).toEqual({ view: "list" });
  });
});
