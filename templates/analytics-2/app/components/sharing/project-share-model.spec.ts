import { describe, expect, it } from "vitest";

import {
  projectShareLink,
  projectShareRows,
  projectShareStatusText,
} from "./project-share-model";

/**
 * Row 599 (P1): the Share panel's rows, link and statuses. The owner is named
 * with the source's "(Owner)" marker, a grant without a profile name shows its
 * identity rather than an empty row, and copying yields the canonical project
 * link. Headless: no browser, no request.
 */
describe("project share panel model", () => {
  it("lists the owner first, marked as the owner, then the grants", () => {
    const rows = projectShareRows({
      ownerEmail: "owner@example.test",
      ownerDisplayName: "Olive Owner",
      shares: [
        {
          id: "sh_1",
          principalType: "user",
          principalId: "member@example.test",
          displayName: "Mo Member",
          role: "viewer",
        },
      ],
    });
    expect(rows.map((row) => row.label)).toEqual(["Olive Owner", "Mo Member"]);
    expect(rows[0]?.owner).toBe(true);
    expect(rows[1]?.owner).toBe(false);
  });

  it("falls back to the identity when a name is missing, and never to a blank row", () => {
    const rows = projectShareRows({
      ownerEmail: "owner@example.test",
      ownerDisplayName: null,
      shares: [
        {
          id: "sh_2",
          principalType: "user",
          principalId: "nameless@example.test",
          displayName: "   ",
          role: "editor",
        },
      ],
    });
    expect(rows.map((row) => row.label)).toEqual([
      "owner@example.test",
      "nameless@example.test",
    ]);
  });

  it("builds the canonical project link and tolerates a trailing slash", () => {
    expect(
      projectShareLink("https://labs.example.test/", "prj_1", "/analytics-2/"),
    ).toBe("https://labs.example.test/analytics-2/project/prj_1/latest");
    expect(
      projectShareLink("https://labs.example.test", "prj 1", "/analytics-2"),
    ).toBe("https://labs.example.test/analytics-2/project/prj%201/latest");
  });

  it("names each panel state, and says nothing when there is nothing to say", () => {
    expect(projectShareStatusText({ kind: "loading" })).toBe("Loading…");
    expect(projectShareStatusText({ kind: "error" })).toBe(
      "Failed to load permissions",
    );
    expect(projectShareStatusText({ kind: "copied" })).toBe("Link copied");
    expect(projectShareStatusText({ kind: "copy-failed" })).toBe(
      "Could not copy the link",
    );
    expect(projectShareStatusText({ kind: "ready" })).toBeNull();
  });
});
