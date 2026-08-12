import { describe, expect, it } from "vitest";

import { type DesignFusionApp, writeFusionApp } from "../../shared/full-app.js";
import {
  type BuilderHostDesignKey,
  matchesBuilderHostKey,
  selectBuilderHostDesignId,
} from "./builder-host-design.js";

const key: BuilderHostDesignKey = {
  builderOrgId: "org-1",
  projectId: "proj-1",
  branchName: "feature/x",
};

const linkage: DesignFusionApp = {
  source: "builder-host",
  builderOrgId: "org-1",
  projectId: "proj-1",
  branchName: "feature/x",
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function row(id: string, overrides: Partial<DesignFusionApp> = {}) {
  return {
    id,
    data: JSON.stringify(writeFusionApp({}, { ...linkage, ...overrides })),
  };
}

describe("matchesBuilderHostKey", () => {
  it("matches on org + project + branch", () => {
    expect(matchesBuilderHostKey(linkage, key)).toBe(true);
  });

  it("does not match a design-app fusion linkage with the same ids", () => {
    expect(
      matchesBuilderHostKey({ ...linkage, source: "design-app" }, key),
    ).toBe(false);
  });

  it("does not match when any key part differs", () => {
    expect(
      matchesBuilderHostKey({ ...linkage, builderOrgId: "org-2" }, key),
    ).toBe(false);
    expect(
      matchesBuilderHostKey({ ...linkage, projectId: "proj-2" }, key),
    ).toBe(false);
    expect(matchesBuilderHostKey({ ...linkage, branchName: "main" }, key)).toBe(
      false,
    );
  });

  it("does not match a linkage missing builderOrgId", () => {
    const { builderOrgId: _omitted, ...withoutOrg } = linkage;
    expect(matchesBuilderHostKey(withoutOrg, key)).toBe(false);
  });
});

describe("selectBuilderHostDesignId", () => {
  it("returns null when nothing matches", () => {
    expect(selectBuilderHostDesignId([], key)).toBeNull();
    expect(
      selectBuilderHostDesignId([row("d1", { branchName: "main" })], key),
    ).toBeNull();
  });

  it("finds the matching row", () => {
    expect(
      selectBuilderHostDesignId(
        [row("other", { branchName: "main" }), row("wanted")],
        key,
      ),
    ).toBe("wanted");
  });

  it("takes the first match so duplicates converge to one design", () => {
    expect(selectBuilderHostDesignId([row("oldest"), row("newer")], key)).toBe(
      "oldest",
    );
  });

  it("ignores rows whose data is not valid design JSON", () => {
    expect(
      selectBuilderHostDesignId(
        [
          { id: "corrupt", data: "not json{" },
          { id: "empty", data: "{}" },
          { id: "null-data", data: null },
          row("wanted"),
        ],
        key,
      ),
    ).toBe("wanted");
  });

  it("ignores a design-app fusion design for the same branch", () => {
    expect(
      selectBuilderHostDesignId(
        [row("design-app", { source: "design-app" })],
        key,
      ),
    ).toBeNull();
  });

  it("accepts already-parsed data objects", () => {
    expect(
      selectBuilderHostDesignId(
        [{ id: "parsed", data: writeFusionApp({}, linkage) }],
        key,
      ),
    ).toBe("parsed");
  });
});
