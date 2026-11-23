// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeMarkup } from "@/skins/reference/testing/markup";
import {
  buttonByText,
  click,
  mount,
  settle,
  type,
  type Mounted,
} from "@/skins/reference/testing/mount";

import {
  preferences,
  savedPreferences,
} from "./AnalyticsAccountPreferences.fixtures";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: { email: "owner@example.test" } }),
}));
vi.mock(
  "@agent-native/toolkit/app/settings/account/PreferencesSettings",
  async () =>
    (await import("./AnalyticsAccountPreferences.fixtures"))
      .accountControlsMock,
);
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsAccountPreferences.fixtures"))
    .preferencesHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

const { AnalyticsAccountPreferences, AnalyticsAccountPreferencesPage } =
  await import("./AnalyticsAccountPreferences");

describe("account preferences, reference markup", () => {
  let mounted: Mounted | undefined;

  beforeEach(() => preferences.reset());
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const golden = (state: string) =>
    expect(normalizeMarkup(mounted!.container.innerHTML)).toMatchFileSnapshot(
      `./__goldens__/AnalyticsAccountPreferences.${state}.html`,
    );

  it("row 126: introduces Preferences before the personalization controls", () => {
    mounted = mount(<AnalyticsAccountPreferencesPage />);
    const introduction = [...mounted.container.querySelectorAll("p")].filter(
      (node) => node.textContent === "Manage your user preferences.",
    );
    expect(introduction).toHaveLength(1);
    const personalization = [...mounted.container.querySelectorAll("h2")].find(
      (node) => node.textContent === "Agent personalization",
    );
    expect(personalization).toBeDefined();
    expect(
      introduction[0]!.compareDocumentPosition(personalization!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("changes and remembers the theme from Preferences", () => {
    localStorage.setItem("theme", "light");
    try {
      mounted = mount(<AnalyticsAccountPreferencesPage />);
      const options = [
        ...mounted.container.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        ),
      ];
      expect(options.map((option) => option.value)).toEqual([
        "system",
        "light",
        "dark",
      ]);
      expect(options[1]?.getAttribute("aria-checked")).toBe("true");
      const dark = options[2];
      if (!dark) throw new Error("Dark theme is missing");
      click(dark);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(localStorage.getItem("theme")).toBe("dark");
    } finally {
      localStorage.removeItem("theme");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.style.removeProperty("color-scheme");
    }
  });

  it("saved instructions, read only", async () => {
    mounted = mount(<AnalyticsAccountPreferences />);
    await golden("ready");
  });

  it("no instructions yet", async () => {
    preferences.saved = savedPreferences("");
    mounted = mount(<AnalyticsAccountPreferences />);
    await golden("ready-empty");
  });

  it("loading", async () => {
    preferences.isLoading = true;
    mounted = mount(<AnalyticsAccountPreferences />);
    await golden("loading");
  });

  it("the instructions could not be loaded", async () => {
    preferences.isError = true;
    preferences.saved = undefined;
    mounted = mount(<AnalyticsAccountPreferences />);
    await golden("load-error");
    click(buttonByText(mounted.container, "Retry"));
    expect(preferences.refetch).toHaveBeenCalledTimes(1);
  });

  it("editing", async () => {
    mounted = mount(<AnalyticsAccountPreferences />);
    click(buttonByText(mounted.container, "Edit"));
    type(
      mounted.container.querySelector("textarea")!,
      "Prefer numbered steps.",
    );
    await golden("editing");
  });

  it("the edit could not be saved", async () => {
    preferences.mutateAsync.mockRejectedValueOnce({
      actionMessage: "Preferences changed. Reload before saving.",
    });
    mounted = mount(<AnalyticsAccountPreferences />);
    click(buttonByText(mounted.container, "Edit"));
    type(
      mounted.container.querySelector("textarea")!,
      "Prefer numbered steps.",
    );
    click(buttonByText(mounted.container, "Save"));
    await settle();
    await golden("save-error");
  });

  it("saved after an edit", async () => {
    mounted = mount(<AnalyticsAccountPreferences />);
    click(buttonByText(mounted.container, "Edit"));
    type(
      mounted.container.querySelector("textarea")!,
      "Prefer numbered steps.",
    );
    click(buttonByText(mounted.container, "Save"));
    await settle();
    expect(preferences.mutateAsync).toHaveBeenCalledWith({
      content: "Prefer numbered steps.",
      expectedOwner: "owner@example.test",
      expectedRevision: { id: "personal-guidance", updatedAt: 12 },
    });
    await golden("saved");
  });
});
