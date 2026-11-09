import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  documentSidebarActionAvailability,
  navigationAfterConfirmedDelete,
  remainingPageAfterDelete,
} from "./document-sidebar-actions";

function access(
  accessRole: NonNullable<Document["accessRole"]>,
): Pick<Document, "accessRole" | "canEdit" | "canManage"> {
  return {
    accessRole,
    canEdit: accessRole !== "viewer",
    canManage: accessRole === "owner" || accessRole === "admin",
  };
}

describe("document sidebar action availability", () => {
  it("gives viewers only the personal Favorite menu action", () => {
    expect(
      documentSidebarActionAvailability(access("viewer"), {
        favoriteAvailable: true,
      }),
    ).toEqual({
      canEdit: false,
      canManage: false,
      canFavorite: true,
      hasMenuActions: true,
    });
  });

  it.each(["editor", "admin", "owner"] as const)(
    "preserves the existing %s capabilities",
    (role) => {
      expect(
        documentSidebarActionAvailability(access(role), {
          favoriteAvailable: true,
        }),
      ).toEqual({
        canEdit: true,
        canManage: role === "admin" || role === "owner",
        canFavorite: true,
        hasMenuActions: true,
      });
    },
  );

  it("does not invent a menu when no Favorite callback or shared action exists", () => {
    expect(
      documentSidebarActionAvailability(access("viewer"), {
        favoriteAvailable: false,
      }),
    ).toMatchObject({
      canFavorite: false,
      hasMenuActions: false,
    });
  });

  it("does not show an empty management menu without a delete callback", () => {
    expect(
      documentSidebarActionAvailability(access("owner"), {
        favoriteAvailable: false,
        manageAvailable: false,
      }),
    ).toMatchObject({
      canManage: true,
      hasMenuActions: false,
    });
  });
});

describe("navigation after a confirmed delete", () => {
  it("stays on the remaining page the sidebar already opened", () => {
    expect(
      navigationAfterConfirmedDelete("/home", { leftDeletedPage: true }),
    ).toBeNull();
  });

  it("follows the server when the open page went with an unloaded parent", () => {
    expect(
      navigationAfterConfirmedDelete("/home", { leftDeletedPage: false }),
    ).toBe("/home");
  });

  it("stays put when the open page survived", () => {
    expect(
      navigationAfterConfirmedDelete(null, { leftDeletedPage: false }),
    ).toBeNull();
    expect(
      navigationAfterConfirmedDelete(undefined, { leftDeletedPage: false }),
    ).toBeNull();
  });
});

describe("the remaining page after a delete", () => {
  const activePath = [
    { id: "projects", parentId: null },
    { id: "launch", parentId: "projects" },
    { id: "notes", parentId: "launch" },
  ];

  it("opens the deleted page's parent", () => {
    expect(
      remainingPageAfterDelete("launch", {
        activePath,
        filesRootDocumentIds: ["projects", "inbox"],
      }),
    ).toBe("projects");
  });

  it("opens a top-level row when the deleted page has no parent", () => {
    expect(
      remainingPageAfterDelete("projects", {
        activePath,
        filesRootDocumentIds: ["projects", "inbox"],
      }),
    ).toBe("inbox");
  });

  it("skips a parent the person can't open or that is also going to Trash", () => {
    expect(
      remainingPageAfterDelete("launch", {
        activePath: [
          { id: "projects", parentId: null, canView: false },
          ...activePath.slice(1),
        ],
        filesRootDocumentIds: ["inbox"],
      }),
    ).toBe("inbox");
    expect(
      remainingPageAfterDelete("launch", {
        activePath,
        filesRootDocumentIds: ["projects", "inbox", "archive"],
        pendingTrashIds: new Set(["projects", "inbox"]),
      }),
    ).toBe("archive");
  });

  it("knows no remaining page without a parent or another top-level row", () => {
    expect(
      remainingPageAfterDelete("projects", {
        activePath,
        filesRootDocumentIds: ["projects"],
      }),
    ).toBeNull();
    expect(
      remainingPageAfterDelete("launch", {
        activePath: [],
        filesRootDocumentIds: [],
      }),
    ).toBeNull();
  });
});
