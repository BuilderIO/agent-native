// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_LINK_DIALOG_OPEN_EVENT,
  githubLinkRequestFromSearch,
  githubLinkReturnPath,
  openGitHubLinkDialog,
  searchWithoutGitHubLink,
} from "./github-link-dialog";

const FOLDER_URL = "https://github.com/acme/handbook/tree/main/docs";

describe("openGitHubLinkDialog", () => {
  it("carries the target and the control that should regain focus", () => {
    const launcher = document.createElement("button");
    const listener = vi.fn();
    window.addEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listener);

    openGitHubLinkDialog({
      target: { kind: "new", spaceId: "space-1", parentId: null },
      returnFocusTo: launcher,
    });

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      target: { kind: "new", spaceId: "space-1", parentId: null },
      returnFocusTo: launcher,
    });
    window.removeEventListener(GITHUB_LINK_DIALOG_OPEN_EVENT, listener);
  });
});

describe("The address GitHub's sign-in returns to", () => {
  it("brings a collection's dialog back with the link typed so far", () => {
    const path = githubLinkReturnPath(
      { pathname: "/page/doc-1", search: "?view=table" },
      { kind: "collection", databaseId: "database-1", documentId: "doc-1" },
      `  ${FOLDER_URL}  `,
    );
    const [pathname, search = ""] = path.split("?");
    expect(pathname).toBe("/page/doc-1");
    expect(githubLinkRequestFromSearch(`?${search}`)).toEqual({
      target: {
        kind: "collection",
        databaseId: "database-1",
        documentId: "doc-1",
      },
      url: FOLDER_URL,
    });
    expect(searchWithoutGitHubLink(`?${search}`)).toBe("?view=table");
  });

  it("brings back a new collection's dialog, with or without a parent page", () => {
    for (const parentId of ["parent-1", null]) {
      const path = githubLinkReturnPath(
        { pathname: "/", search: "" },
        { kind: "new", spaceId: "space-1", parentId },
      );
      expect(githubLinkRequestFromSearch(path.slice(1))).toEqual({
        target: { kind: "new", spaceId: "space-1", parentId },
        url: undefined,
      });
    }
  });

  it("replaces an earlier dialog's params rather than piling them up", () => {
    const first = githubLinkReturnPath(
      { pathname: "/", search: "" },
      { kind: "new", spaceId: "space-1", parentId: "parent-1" },
      FOLDER_URL,
    );
    const second = githubLinkReturnPath(
      { pathname: "/", search: first.slice(1) },
      { kind: "new", spaceId: "space-2", parentId: null },
    );
    const params = new URLSearchParams(second.slice(2));
    expect(params.getAll("githubId")).toEqual(["space-2"]);
    expect(params.has("githubPage")).toBe(false);
    expect(params.has("githubUrl")).toBe(false);
  });

  it.each([
    ["no dialog params", "?view=table"],
    ["a collection without its page", "?githubLink=collection&githubId=db-1"],
    ["an unknown kind", "?githubLink=other&githubId=db-1&githubPage=doc-1"],
    ["no id", "?githubLink=new"],
  ])("reopens nothing for %s", (_name, search) => {
    expect(githubLinkRequestFromSearch(search)).toBe(null);
  });

  it("leaves no question mark once only the dialog's params were there", () => {
    expect(
      searchWithoutGitHubLink("?githubLink=new&githubId=space-1&githubUrl=x"),
    ).toBe("");
  });
});
