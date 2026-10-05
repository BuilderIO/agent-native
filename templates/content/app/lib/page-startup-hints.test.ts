// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { LAST_LOCATION_HINT_STORAGE_KEY } from "./last-location-hint";
import {
  CONTENT_STARTUP_PAGE_HINTS_SCRIPT,
  STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
  STARTUP_PAGE_SHAPE_ATTRIBUTE,
  readDocumentShapeHint,
  readPageIconRowHint,
  readPageShapeHint,
  rememberPageIconRow,
  rememberPageShape,
} from "./page-startup-hints";

function runStartupScript(
  path: string,
  attribute = STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
) {
  window.history.replaceState(null, "", path);
  document.documentElement.removeAttribute(STARTUP_PAGE_ICON_ROW_ATTRIBUTE);
  document.documentElement.removeAttribute(STARTUP_PAGE_SHAPE_ATTRIBUTE);
  new Function(CONTENT_STARTUP_PAGE_HINTS_SCRIPT)();
  return document.documentElement.getAttribute(attribute);
}

describe("page icon row hint", () => {
  beforeEach(() => localStorage.clear());

  it("holds the Add icon row for a page this browser has not drawn", () => {
    expect(readPageIconRowHint("page-1")).toBe("add");
  });

  it("returns the row each page last drew", () => {
    rememberPageIconRow("page-1", "icon");
    rememberPageIconRow("page-2", "none");

    expect(readPageIconRowHint("page-1")).toBe("icon");
    expect(readPageIconRowHint("page-2")).toBe("none");

    rememberPageIconRow("page-1", "add");
    expect(readPageIconRowHint("page-1")).toBe("add");
    expect(
      Object.keys(
        JSON.parse(localStorage.getItem("content-page-icon-rows-v1")!),
      ),
    ).toEqual(["page-2"]);
  });

  it("keeps the 200 pages drawn most recently", () => {
    for (let index = 0; index < 205; index += 1) {
      rememberPageIconRow(`page-${index}`, "icon");
    }

    expect(readPageIconRowHint("page-4")).toBe("add");
    expect(readPageIconRowHint("page-5")).toBe("icon");
    expect(readPageIconRowHint("page-204")).toBe("icon");
  });

  it("refreshes a page's recency when its remembered row is unchanged", () => {
    for (let index = 0; index < 200; index += 1) {
      rememberPageIconRow(`page-${index}`, "icon");
    }

    rememberPageIconRow("page-0", "icon");
    rememberPageIconRow("page-200", "icon");

    expect(readPageIconRowHint("page-0")).toBe("icon");
    expect(readPageIconRowHint("page-1")).toBe("add");
    expect(readPageIconRowHint("page-2")).toBe("icon");
    expect(readPageIconRowHint("page-200")).toBe("icon");
  });

  it("ignores a malformed hint", () => {
    localStorage.setItem("content-page-icon-rows-v1", "not json");
    expect(readPageIconRowHint("page-1")).toBe("add");
    rememberPageIconRow("page-1", "none");
    expect(readPageIconRowHint("page-1")).toBe("none");
  });

  it("marks the page's row before the app loads, under any base path", () => {
    rememberPageIconRow("page-1", "icon");
    rememberPageIconRow("page-2", "none");

    expect(runStartupScript("/page/page-1")).toBe("icon");
    expect(runStartupScript("/content/page/page-2/view/table")).toBe("none");
    expect(runStartupScript("/page/page-3")).toBeNull();
    expect(runStartupScript("/home")).toBeNull();
  });
});

describe("page shape hint", () => {
  beforeEach(() => localStorage.clear());

  it("holds a plain page for a page this browser has not drawn", () => {
    expect(readPageShapeHint("page-1")).toBe("page");
  });

  it("returns the shape each page last drew and forgets the default", () => {
    rememberPageShape("page-1", "review");
    rememberPageShape("page-2", "database-constrained");

    expect(readPageShapeHint("page-1")).toBe("review");
    expect(readPageShapeHint("page-2")).toBe("database-constrained");

    rememberPageShape("page-1", "page");
    expect(readPageShapeHint("page-1")).toBe("page");
    expect(
      Object.keys(JSON.parse(localStorage.getItem("content-page-shapes-v1")!)),
    ).toEqual(["page-2"]);
  });

  it("keeps a loaded page's own kind over a stale hint", () => {
    rememberPageShape("page-1", "review");
    rememberPageShape("page-2", "database-constrained");

    expect(readDocumentShapeHint({ id: "page-1", database: {} })).toBe(
      "database",
    );
    expect(readDocumentShapeHint({ id: "page-2" })).toBe("page");
    expect(readDocumentShapeHint({ id: "page-2", database: {} })).toBe(
      "database-constrained",
    );
    expect(readDocumentShapeHint({ id: "page-1" })).toBe("review");
  });

  it("ignores a malformed or unknown hint", () => {
    localStorage.setItem("content-page-shapes-v1", "not json");
    expect(readPageShapeHint("page-1")).toBe("page");
    localStorage.setItem(
      "content-page-shapes-v1",
      JSON.stringify({ "page-1": "sidebar" }),
    );
    expect(readPageShapeHint("page-1")).toBe("page");
  });

  it("marks the page's shape before the app loads", () => {
    rememberPageShape("page-1", "review");
    rememberPageShape("page-2", "database");
    localStorage.setItem("content-page-icon-rows-v1", "not json");

    expect(runStartupScript("/page/page-1", STARTUP_PAGE_SHAPE_ATTRIBUTE)).toBe(
      "review",
    );
    expect(
      runStartupScript("/content/page/page-2", STARTUP_PAGE_SHAPE_ATTRIBUTE),
    ).toBe("database");
    expect(
      runStartupScript("/page/page-3", STARTUP_PAGE_SHAPE_ATTRIBUTE),
    ).toBeNull();
    expect(
      runStartupScript("/page/%E0%A4%A", STARTUP_PAGE_SHAPE_ATTRIBUTE),
    ).toBeNull();
  });

  it("marks the last page's shape on home unless a space is selected", () => {
    rememberPageShape("page-1", "review");
    localStorage.setItem(
      LAST_LOCATION_HINT_STORAGE_KEY,
      JSON.stringify({ scope: "account-org", documentId: "page-1" }),
    );

    expect(runStartupScript("/home", STARTUP_PAGE_SHAPE_ATTRIBUTE)).toBe(
      "review",
    );
    expect(
      runStartupScript("/content/home", STARTUP_PAGE_SHAPE_ATTRIBUTE),
    ).toBe("review");
    expect(
      runStartupScript("/home?spaceId=space-1", STARTUP_PAGE_SHAPE_ATTRIBUTE),
    ).toBeNull();
  });
});
