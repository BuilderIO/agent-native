// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  buttonByText,
  click,
  mount,
  settle,
  type Mounted,
} from "@/skins/reference/testing/mount";

import { invitation, users } from "./AnalyticsUsersPage.fixtures";
import { roleRequest, roleRequests } from "./RoleRequests.fixtures";

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

describe("users page, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => {
    roleRequests.reset();
    users.reset();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsUsersPage.${state}.html`,
    );

  it("invite links: no pending invitation", async () => {
    mounted = mount(<InviteLinks />);
    await golden("invite-links.empty");
  });

  it("invite links: pending invitations", async () => {
    users.invitations = [
      invitation("invite-1", "invited@example.test"),
      invitation("invite 2", "second@example.test"),
    ];
    mounted = mount(<InviteLinks />);
    await golden("invite-links.ready");
  });

  it("invite links: copying leaves the list as it was", async () => {
    users.invitations = [invitation("invite-1", "invited@example.test")];
    mounted = mount(<InviteLinks />);
    click(buttonByText(mounted.container, "Copy link"));
    await settle();
    expect(users.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/join/invite-1"),
    );
    expect(users.toastSuccess).toHaveBeenCalledWith("Invite link copied");
    await golden("invite-links.copied");
  });

  it("the page: invite links, role requests and the members surface", async () => {
    users.invitations = [invitation("invite-1", "invited@example.test")];
    roleRequests.requests = [roleRequest("role-request-1", "ada@example.test")];
    mounted = mount(<AnalyticsUsersPage isAdmin />);
    await golden("page.ready");
  });

  it("the page: nothing pending", async () => {
    mounted = mount(<AnalyticsUsersPage isAdmin />);
    await golden("page.empty");
  });
});
