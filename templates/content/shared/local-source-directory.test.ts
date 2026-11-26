import { describe, expect, it } from "vitest";

import {
  isLocalSourceDirectoryId,
  localSourceDirectoryId,
  localSourceDirectoryTitle,
  localSourceFileDirectory,
  parentLocalSourceDirectory,
  parseLocalSourceDirectoryId,
} from "./local-source-directory";

describe("a linked folder's directory", () => {
  it("keeps the same ID for the same folder and directory", () => {
    const id = localSourceDirectoryId({
      rootPath: "vault:1",
      path: "daily notes/2026",
    });

    expect(id).toBe("local-source-directory:vault%3A1:daily%20notes%2F2026");
    expect(isLocalSourceDirectoryId(id)).toBe(true);
    expect(parseLocalSourceDirectoryId(id)).toEqual({
      rootPath: "vault:1",
      path: "daily notes/2026",
    });
  });

  it("names no folder for a page ID or a malformed folder ID", () => {
    for (const id of [
      "page-id",
      "local-source-directory:vault",
      "local-source-directory:vault:notes:extra",
      "local-source-directory::notes",
      "local-source-directory:vault:%E0%A4%A",
      "local-source-directory:vault:notes%2F..%2Fsecret",
      "local-source-directory:vault:%2Fnotes",
      "local-source-directory:vault:notes/2026",
    ]) {
      expect(parseLocalSourceDirectoryId(id)).toBeNull();
    }
  });

  it("finds the directory a file sits in, or none it can place", () => {
    expect(localSourceFileDirectory("notes/2026/today.md")).toBe("notes/2026");
    expect(localSourceFileDirectory("README.md")).toBe("");
    expect(localSourceFileDirectory("/notes/today.md")).toBeNull();
    expect(localSourceFileDirectory("notes//today.md")).toBeNull();
    expect(localSourceFileDirectory("notes/../today.md")).toBeNull();
    expect(localSourceFileDirectory(null)).toBeNull();
  });

  it("steps up to the folder above, ending at the top", () => {
    expect(
      parentLocalSourceDirectory({ rootPath: "vault", path: "notes/2026" }),
    ).toEqual({ rootPath: "vault", path: "notes" });
    expect(
      parentLocalSourceDirectory({ rootPath: "vault", path: "notes" }),
    ).toBeNull();
  });

  it("titles a folder by its last name, reading dashes and underscores as spaces", () => {
    expect(localSourceDirectoryTitle("notes/daily-notes_2026")).toBe(
      "daily notes 2026",
    );
    expect(localSourceDirectoryTitle("2026")).toBe("2026");
  });
});
