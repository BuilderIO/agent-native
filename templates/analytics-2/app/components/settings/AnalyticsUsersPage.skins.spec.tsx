// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle } from "@/skins/reference/testing/mount";
import { SKINS, partControl, tagged } from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

import { invitation, users } from "./AnalyticsUsersPage.fixtures";
import { roleRequest, roleRequests } from "./RoleRequests.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./RoleRequests.fixtures")).roleRequestHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));
vi.mock("@agent-native/core/client/org", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/org")>()),
  ...(await import("./AnalyticsUsersPage.fixtures")).orgMock,
}));
vi.mock(
  "@agent-native/toolkit/app/org",
  async () => (await import("./AnalyticsUsersPage.fixtures")).orgPageMock,
);
vi.mock(
  "sonner",
  async () => (await import("./AnalyticsUsersPage.fixtures")).toastMock,
);

const { AnalyticsUsersPage, InviteLinks } =
  await import("./AnalyticsUsersPage");

const LINKS = "settings.users.invite-links";

const copy = (root: ParentNode, key: string) =>
  partControl(
    root,
    `${LINKS}.item.copy-link`,
    "settings.collection.action",
    key,
  );

function reset() {
  roleRequests.reset();
  users.reset();
}

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  "invite-links.empty": { arrange: reset, ui: () => <InviteLinks /> },
  "invite-links.ready": {
    arrange: () => {
      reset();
      users.invitations = [
        invitation("invite-1", "invited@example.test"),
        invitation("invite 2", "second@example.test"),
      ];
    },
    ui: () => <InviteLinks />,
  },
  "invite-links.copied": {
    arrange: () => {
      reset();
      users.invitations = [invitation("invite-1", "invited@example.test")];
    },
    ui: () => <InviteLinks />,
    drive: async ({ container }) => {
      click(copy(container, "invite-1"));
      await settle();
    },
  },
  "page.ready": {
    arrange: () => {
      reset();
      users.invitations = [invitation("invite-1", "invited@example.test")];
      roleRequests.requests = [
        roleRequest("role-request-1", "ada@example.test"),
      ];
    },
    ui: () => <AnalyticsUsersPage isAdmin />,
  },
  "page.empty": { arrange: reset, ui: () => <AnalyticsUsersPage isAdmin /> },
};

const REMAINING: Record<string, string[]> = {};

describe("users page, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    expect(await skinDifferences(STATES[name]!)).toEqual(REMAINING[name] ?? []);
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(reset);

    it("copies one invitation's link by item key and says so", async () => {
      users.invitations = [
        invitation("invite-1", "invited@example.test"),
        invitation("invite 2", "second@example.test"),
      ];
      const mounted = mount(<InviteLinks />, skin);
      try {
        expect(
          tagged(
            mounted.container,
            `${LINKS}.item`,
            "settings.collection.item",
            "invite 2",
          ).textContent,
        ).toContain("/join/invite%202");
        click(copy(mounted.container, "invite 2"));
        await settle();
        expect(users.writeText).toHaveBeenCalledWith(
          expect.stringContaining("/join/invite%202"),
        );
        expect(users.toastSuccess).toHaveBeenCalledWith("Invite link copied");
      } finally {
        mounted.unmount();
      }
    });

    it("says the link could not be copied", async () => {
      users.invitations = [invitation("invite-1", "invited@example.test")];
      users.writeText.mockRejectedValueOnce(new Error("denied"));
      const mounted = mount(<InviteLinks />, skin);
      try {
        click(copy(mounted.container, "invite-1"));
        await settle();
        expect(users.toastError).toHaveBeenCalledWith(
          "The invite link could not be copied.",
        );
      } finally {
        mounted.unmount();
      }
    });

    it("says there is nothing to share when no invitation is pending", () => {
      const mounted = mount(<InviteLinks />, skin);
      try {
        expect(
          tagged(
            mounted.container,
            `${LINKS}.empty`,
            "settings.collection.empty",
          ).textContent,
        ).toBe("No pending invitations. Invite someone to get a link.");
      } finally {
        mounted.unmount();
      }
    });
  });
});
