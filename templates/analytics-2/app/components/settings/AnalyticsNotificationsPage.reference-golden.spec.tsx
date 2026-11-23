// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  click,
  mount,
  settle,
  type Mounted,
} from "@/skins/reference/testing/mount";

import { notifications } from "./AnalyticsNotificationsPage.fixtures";

vi.mock(
  "@agent-native/core/client/resources/use-resources",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/core/client/resources/use-resources")
    >()),
    ...(await import("./AnalyticsNotificationsPage.fixtures")).resourcesMock,
  }),
);
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

const { AnalyticsNotificationsPage } =
  await import("./AnalyticsNotificationsPage");

describe("notifications page, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => notifications.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsNotificationsPage.${state}.html`,
    );

  it("the list of resources is loading", async () => {
    notifications.listPending = true;
    mounted = mount(<AnalyticsNotificationsPage />);
    await golden("loading");
  });

  it("the stored settings are loading", async () => {
    notifications.stored = { desktopNotifications: true };
    notifications.resourcePending = true;
    mounted = mount(<AnalyticsNotificationsPage />);
    await golden("loading-stored");
  });

  it("nothing stored yet: off", async () => {
    mounted = mount(<AnalyticsNotificationsPage />);
    await golden("ready-off");
  });

  it("stored on", async () => {
    notifications.stored = { desktopNotifications: true };
    mounted = mount(<AnalyticsNotificationsPage />);
    await golden("ready-on");
  });

  it("a write is in flight", async () => {
    notifications.stored = { desktopNotifications: true };
    notifications.saving = true;
    mounted = mount(<AnalyticsNotificationsPage />);
    await golden("saving");
  });

  it("switched on, which creates the settings resource", async () => {
    mounted = mount(<AnalyticsNotificationsPage />);
    click(mounted.container.querySelector('[role="switch"]')!);
    await settle();
    expect(notifications.create).toHaveBeenCalledWith({
      path: "settings/notifications.json",
      content: JSON.stringify({ desktopNotifications: true }, null, 2),
      mimeType: "application/json",
    });
    await golden("switched-on");
  });

  it("a failed write puts the switch back", async () => {
    notifications.stored = { desktopNotifications: true };
    notifications.update.mockRejectedValueOnce(new Error("offline"));
    mounted = mount(<AnalyticsNotificationsPage />);
    click(mounted.container.querySelector('[role="switch"]')!);
    await settle();
    expect(notifications.update).toHaveBeenCalledWith({
      id: "resource-1",
      content: JSON.stringify({ desktopNotifications: false }, null, 2),
    });
    await golden("write-failed");
  });
});
