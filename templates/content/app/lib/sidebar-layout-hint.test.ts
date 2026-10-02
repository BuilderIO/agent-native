// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  readSidebarLayoutHint,
  rememberSidebarLayout,
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
    const branches: Record<string, unknown> = {
      "folder-bad": { rows: -1 },
      "folder-big": { rows: 500, more: true },
    };
    for (let index = 0; index < 40; index += 1) {
      branches[`folder-${index}`] = { rows: 2, more: false };
    }
    localStorage.setItem(
      "content-sidebar-layout-v1",
      JSON.stringify({ scope: SCOPE, spaceId: "space-1", branches }),
    );

    const read = readSidebarLayoutHint(SCOPE, "space-1").branches!;
    expect(read).not.toHaveProperty("folder-bad");
    expect(read["folder-big"]).toEqual({ rows: 100, more: true });
    expect(Object.keys(read).length).toBeLessThanOrEqual(32);

    localStorage.setItem(
      "content-sidebar-layout-v1",
      JSON.stringify({ scope: SCOPE, spaceId: "space-1", branches: ["x"] }),
    );
    expect(readSidebarLayoutHint(SCOPE, "space-1").branches).toBeUndefined();
  });
});
