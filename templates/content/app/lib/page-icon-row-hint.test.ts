// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  CONTENT_STARTUP_PAGE_ICON_ROW_SCRIPT,
  STARTUP_PAGE_ICON_ROW_ATTRIBUTE,
  readPageIconRowHint,
  rememberPageIconRow,
} from "./page-icon-row-hint";

function runStartupScript(path: string) {
  window.history.replaceState(null, "", path);
  document.documentElement.removeAttribute(STARTUP_PAGE_ICON_ROW_ATTRIBUTE);
  new Function(CONTENT_STARTUP_PAGE_ICON_ROW_SCRIPT)();
  return document.documentElement.getAttribute(STARTUP_PAGE_ICON_ROW_ATTRIBUTE);
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
