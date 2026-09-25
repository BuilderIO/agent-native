import { describe, expect, it } from "vitest";

import { assertSlashRollbackEligible } from "./rollback-created-slash-document";

const eligible = {
  actor: "editor@example.com",
  child: {
    id: "new-page",
    createdBy: "editor@example.com",
    createdAt: "2026-09-23T18:00:00.000Z",
    updatedAt: "2026-09-23T18:00:00.000Z",
    content: "",
    parentId: "host-page",
    trashedAt: null,
  },
  parentId: "host-page",
  parentContent: "Existing parent text",
  ownerBlockId: null,
  hasChildren: false,
  hasDatabaseItems: false,
  now: Date.parse("2026-09-23T18:01:00.000Z"),
};

describe("failed slash creation rollback eligibility", () => {
  it("allows the creator to remove an unlinked, unchanged child", () => {
    expect(() => assertSlashRollbackEligible(eligible)).not.toThrow();
  });

  it("rejects a different editor and an already linked child", () => {
    expect(() =>
      assertSlashRollbackEligible({ ...eligible, actor: "other@example.com" }),
    ).toThrow("Only the creator");
    expect(() =>
      assertSlashRollbackEligible({
        ...eligible,
        parentContent: 'A reference to id="new-page"',
      }),
    ).toThrow("already linked");
  });

  it("rejects changed or stale resources", () => {
    expect(() =>
      assertSlashRollbackEligible({
        ...eligible,
        child: { ...eligible.child, content: "new work" },
      }),
    ).toThrow("changed");
    expect(() =>
      assertSlashRollbackEligible({
        ...eligible,
        now: Date.parse("2026-09-23T18:06:00.000Z"),
      }),
    ).toThrow("changed");
  });
});
