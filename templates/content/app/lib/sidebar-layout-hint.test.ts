// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  readSidebarLayoutHint,
  rememberSidebarLayout,
  withShownFilesBranch,
} from "./sidebar-layout-hint";

const SCOPE = JSON.stringify(["owner@example.test", "org-a"]);

describe("sidebar layout hint", () => {
  beforeEach(() => localStorage.clear());

  it("keeps open folders by ID with the rows they drew", () => {
    rememberSidebarLayout(SCOPE, "space-1", {
      files: { rows: 7, more: false },
    });
    rememberSidebarLayout(SCOPE, "space-1", {
      branches: { "folder-a": { rows: 3, more: true } },
    });

    expect(readSidebarLayoutHint(SCOPE, "space-1")).toMatchObject({
      files: { rows: 7, more: false },
      branches: { "folder-a": { rows: 3, more: true } },
    });
    expect(readSidebarLayoutHint(SCOPE, null).branches).toEqual({
      "folder-a": { rows: 3, more: true },
    });
    expect(readSidebarLayoutHint(SCOPE, "space-2").branches).toBeUndefined();
  });

  it("bounds what it reads back and drops malformed folders", () => {
    const branches: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) {
      branches[`folder-${index}`] = { rows: 2, more: false };
    }
    branches["folder-bad"] = { rows: -1 };
    branches["folder-big"] = { rows: 500, more: true };
    localStorage.setItem(
      "content-sidebar-layout-v1",
      JSON.stringify({ scope: SCOPE, spaceId: "space-1", branches }),
    );

    const read = readSidebarLayoutHint(SCOPE, "space-1").branches!;
    expect(read).not.toHaveProperty("folder-bad");
    expect(read["folder-big"]).toEqual({ rows: 100, more: true });
    expect(Object.keys(read).length).toBeLessThanOrEqual(32);
    expect(read).not.toHaveProperty("folder-0");

    localStorage.setItem(
      "content-sidebar-layout-v1",
      JSON.stringify({ scope: SCOPE, spaceId: "space-1", branches: ["x"] }),
    );
    expect(readSidebarLayoutHint(SCOPE, "space-1").branches).toBeUndefined();
  });

  it("keeps the most recently drawn folders once the cap is full", () => {
    const rows = { rows: 2, more: false };
    let branches: Record<string, { rows: number; more: boolean }> = {};
    for (let index = 0; index < 32; index += 1) {
      branches = withShownFilesBranch(branches, `folder-${index}`, rows);
    }
    rememberSidebarLayout(SCOPE, "space-1", { branches });

    const show = (documentId: string) =>
      rememberSidebarLayout(SCOPE, "space-1", {
        branches: withShownFilesBranch(
          readSidebarLayoutHint(SCOPE, "space-1").branches,
          documentId,
          rows,
        ),
      });
    // Drawn again, the oldest folder counts as recent.
    show("folder-0");
    show("folder-new");

    const read = readSidebarLayoutHint(SCOPE, "space-1").branches!;
    expect(Object.keys(read)).toHaveLength(32);
    expect(read).toHaveProperty("folder-new");
    expect(read).toHaveProperty("folder-0");
    expect(read).not.toHaveProperty("folder-1");
  });
});
