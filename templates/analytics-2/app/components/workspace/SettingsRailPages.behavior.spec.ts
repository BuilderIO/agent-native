import { describe, expect, it } from "vitest";

import { resolveRoutePage } from "./pages";
import { NAV_GROUPS } from "./SettingsShell";

/**
 * Every tab the settings rail draws is a link. A tab with no registered page is a
 * link to an empty frame: testers hit exactly that on Settings > Users
 * (sprint-analytics-2#153 - "no member details, no role requests, allowed email
 * domains, invite links or invite").
 *
 * The check is total: tabs that still have no page are written down here, so a new
 * tab without a page fails this test instead of shipping a blank surface, and a
 * wired tab must drop its entry.
 */
const PENDING: Record<string, string> = {
  // The shared shell renders these inside its own <SettingsShell> and none is a
  // standalone export, so their content has to be chosen against a capture of the
  // running original rather than relabelled from another app.
  "project-security": "security page lives only inside the shared shell",
  styling: "no styled page in the tree yet",
  "trusted-mode": "governed mode page needs the shared shell context",
  "context-studio": "studio page is its own rebuild slice (row 213)",
  environment: "infrastructure page needs the shared shell context",
  "scheduled-runs": "scheduled runs page needs the shared shell context",
};

function railTabs(): string[] {
  return NAV_GROUPS.flatMap((group) => group.items.map((item) => item.tab));
}

function resolves(tab: string) {
  return resolveRoutePage({ id: "settings", view: tab } as never)?.component;
}

describe("every settings rail tab", () => {
  it("either opens a page or is on the written-down pending list", () => {
    const dead = railTabs().filter(
      (tab) => !resolves(tab) && !(tab in PENDING),
    );
    expect(
      dead,
      `tabs with no page and no pending entry: ${dead.join(", ")}`,
    ).toEqual([]);
  });

  it("never lists a pending tab that already has a page", () => {
    // Wiring a page has to remove its pending entry, otherwise the list rots and a
    // real dead link hides behind a stale excuse.
    const stale = Object.keys(PENDING).filter((tab) => resolves(tab));
    expect(stale, `pending but wired: ${stale.join(", ")}`).toEqual([]);
  });

  it("only names tabs the rail actually renders", () => {
    const rendered = new Set(railTabs());
    const unknown = Object.keys(PENDING).filter((tab) => !rendered.has(tab));
    expect(
      unknown,
      `pending tabs the rail dropped: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("opens the shared Skills surface from the rail (rows 208-210)", () => {
    expect(resolves("skills")).toBeTruthy();
  });

  it("opens distinct credential surfaces for API keys and secrets", () => {
    expect(resolves("api-keys")).toBeTruthy();
    expect(resolves("secrets")).toBeTruthy();
    expect(resolves("api-keys")).not.toBe(resolves("users"));
    expect(resolves("secrets")).not.toBe(resolves("api-keys"));
  });
});
