import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import { documentSidebarActionAvailability } from "./document-sidebar-actions";

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
