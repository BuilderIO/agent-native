// @vitest-environment happy-dom

import { Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { designSystem } from "@/design-system";
import { referenceDesignSystem } from "@/skins/reference/design-system";
import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  click,
  mount,
  settle,
  type Mounted,
} from "@/skins/reference/testing/mount";
import { rowControl } from "@/skins/reference/testing/skins";

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

const { analyticsWorkspaceSettingsPages } =
  await import("./AnalyticsWorkspaceSettings");

/** The notifications page as the settings registry holds it: registered from its sections, not as a component. */
function registeredPage() {
  const page = analyticsWorkspaceSettingsPages.find(
    (entry) => entry.id === "analytics-notifications",
  );
  if (!page) throw new Error("the notifications page is not registered");
  // The page reads nothing from the shell's props.
  const Page = page.component as unknown as ComponentType;
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}

describe("the notifications page, registered from its sections", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => notifications.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  // The golden files are the ones the panel's own golden spec wrote from the
  // component before any of this; the registered page has to draw the same.
  it.each([
    ["nothing stored yet", "ready-off", () => undefined],
    [
      "stored on",
      "ready-on",
      () => {
        notifications.stored = { desktopNotifications: true };
      },
    ],
    [
      "loading",
      "loading",
      () => {
        notifications.listPending = true;
      },
    ],
  ])(
    "draws the component's reference markup: %s",
    async (_name, state, arrange) => {
      arrange();
      mounted = mount(registeredPage(), referenceDesignSystem);
      await settle();
      await expect(
        normalizeMarkup(mounted.container.innerHTML),
      ).toMatchFileSnapshot(
        `./__goldens__/AnalyticsNotificationsPage.${state}.html`,
      );
    },
  );

  it.each([
    ["reference", referenceDesignSystem],
    ["house", designSystem],
  ])("writes through its row in the %s skin", async (_name, skin) => {
    mounted = mount(registeredPage(), skin);
    await settle();
    click(
      rowControl(
        mounted.container,
        "settings.notifications.desktop-notifications",
      ),
    );
    await settle();
    expect(notifications.create).toHaveBeenCalledWith({
      path: "settings/notifications.json",
      content: JSON.stringify({ desktopNotifications: true }, null, 2),
      mimeType: "application/json",
    });
  });
});
