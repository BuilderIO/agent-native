import { describe, expect, it } from "vitest";

import { sql } from "../db/sql.js";
import { canonicalResourcePath, resourcePathNamedSql } from "./path-form.js";

describe("canonicalResourcePath", () => {
  it("drops every leading slash", () => {
    expect(canonicalResourcePath("/notes.md")).toBe("notes.md");
    expect(canonicalResourcePath("///notes.md")).toBe("notes.md");
  });

  it("leaves a name without a leading slash as it is", () => {
    expect(canonicalResourcePath("notes.md")).toBe("notes.md");
    expect(canonicalResourcePath("")).toBe("");
  });

  it("keeps the slashes inside and after the name", () => {
    expect(canonicalResourcePath("docs/a/notes.md")).toBe("docs/a/notes.md");
    expect(canonicalResourcePath("/docs//notes.md/")).toBe("docs//notes.md/");
  });

  it("turns a path of only slashes into an empty name", () => {
    expect(canonicalResourcePath("//")).toBe("");
  });
});

describe("resourcePathNamedSql", () => {
  it("matches the name, its one-slash spelling, and any longer run of slashes", () => {
    const query = resourcePathNamedSql(sql`path`, ["notes.md"]);

    expect(query.sql).toBe(
      "(path IN (?, ?) OR (path LIKE '//%' AND ltrim(path, '/') IN (?)))",
    );
    expect(query.args).toEqual(["notes.md", "/notes.md", "notes.md"]);
  });

  it("binds each name once, however it was spelled", () => {
    const query = resourcePathNamedSql(sql`path`, [
      "notes.md",
      "/notes.md",
      "//notes.md",
    ]);

    expect(query.args).toEqual(["notes.md", "/notes.md", "notes.md"]);
  });

  it("matches several names in one condition", () => {
    const query = resourcePathNamedSql(sql`r.path`, ["a.md", "/b.md"]);

    expect(query.sql).toBe(
      "(r.path IN (?, ?, ?, ?) OR (r.path LIKE '//%' AND ltrim(r.path, '/') IN (?, ?)))",
    );
    expect(query.args).toEqual([
      "a.md",
      "/a.md",
      "b.md",
      "/b.md",
      "a.md",
      "b.md",
    ]);
  });
});
