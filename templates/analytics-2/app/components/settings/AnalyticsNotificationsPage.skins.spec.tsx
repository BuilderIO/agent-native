// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle } from "@/skins/reference/testing/mount";
import { SKINS, rowControl } from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

import { notifications } from "./AnalyticsNotificationsPage.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

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

const DESKTOP = "settings.notifications.desktop-notifications";
const ui = () => <AnalyticsNotificationsPage />;
const flip: SkinCase["drive"] = async ({ container }) => {
  click(rowControl(container, DESKTOP));
  await settle();
};

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  loading: {
    arrange: () => {
      notifications.reset();
      notifications.listPending = true;
    },
    ui,
  },
  "loading-stored": {
    arrange: () => {
      notifications.reset();
      notifications.stored = { desktopNotifications: true };
      notifications.resourcePending = true;
    },
    ui,
  },
  "ready-off": { arrange: () => notifications.reset(), ui },
  "ready-on": {
    arrange: () => {
      notifications.reset();
      notifications.stored = { desktopNotifications: true };
    },
    ui,
  },
  saving: {
    arrange: () => {
      notifications.reset();
      notifications.stored = { desktopNotifications: true };
      notifications.saving = true;
    },
    ui,
  },
  "switched-on": { arrange: () => notifications.reset(), ui, drive: flip },
  "write-failed": {
    arrange: () => {
      notifications.reset();
      notifications.stored = { desktopNotifications: true };
      notifications.update.mockRejectedValueOnce(new Error("offline"));
    },
    ui,
    drive: flip,
  },
};

describe("notifications page, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    expect(await skinDifferences(STATES[name]!)).toEqual([]);
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(() => notifications.reset());

    it("switches desktop notifications on, then off, and stores each", async () => {
      const mounted = mount(ui(), skin);
      try {
        const control = () => rowControl(mounted.container, DESKTOP);
        expect(control().getAttribute("aria-checked")).toBe("false");
        click(control());
        await settle();
        expect(notifications.create).toHaveBeenCalledWith({
          path: "settings/notifications.json",
          content: JSON.stringify({ desktopNotifications: true }, null, 2),
          mimeType: "application/json",
        });
        expect(control().getAttribute("aria-checked")).toBe("true");
        click(control());
        await settle();
        expect(notifications.update).toHaveBeenCalledWith({
          id: "resource-1",
          content: JSON.stringify({ desktopNotifications: false }, null, 2),
        });
        expect(control().getAttribute("aria-checked")).toBe("false");
      } finally {
        mounted.unmount();
      }
    });

    it("puts the switch back when the write fails", async () => {
      notifications.stored = { desktopNotifications: true };
      notifications.update.mockRejectedValueOnce(new Error("offline"));
      const mounted = mount(ui(), skin);
      try {
        click(rowControl(mounted.container, DESKTOP));
        await settle();
        expect(notifications.update).toHaveBeenCalledTimes(1);
        expect(
          rowControl(mounted.container, DESKTOP).getAttribute("aria-checked"),
        ).toBe("true");
      } finally {
        mounted.unmount();
      }
    });

    it("does not write while a write is in flight", async () => {
      notifications.stored = { desktopNotifications: true };
      notifications.saving = true;
      const mounted = mount(ui(), skin);
      try {
        const control = rowControl(mounted.container, DESKTOP);
        expect(control.hasAttribute("disabled")).toBe(true);
        click(control);
        await settle();
        expect(notifications.update).not.toHaveBeenCalled();
      } finally {
        mounted.unmount();
      }
    });
  });
});
