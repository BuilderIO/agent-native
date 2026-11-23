// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle, type } from "@/skins/reference/testing/mount";
import {
  SKINS,
  partControl,
  rowControl,
  tagged,
} from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

import {
  preferences,
  savedPreferences,
} from "./AnalyticsAccountPreferences.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

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

const { AnalyticsAccountPreferences } =
  await import("./AnalyticsAccountPreferences");

const ROW = "settings.preferences.personal-preferences";
const ui = () => <AnalyticsAccountPreferences />;
/** Before an edit the row's control is its edit button; during one it is the text area. */
const control = (root: ParentNode) => rowControl(root, ROW);
const saveButton = (root: ParentNode) =>
  partControl(root, `${ROW}.save`, "settings.row.action");
/** A failed read's retry belongs to the row and has no id of its own: it is the row's one button. */
const retry = (root: ParentNode) =>
  tagged(root, ROW, "settings.row").querySelector(
    "button",
  ) as HTMLButtonElement;
const edit: NonNullable<SkinCase["drive"]> = ({ container }) => {
  click(control(container));
  type(control(container) as HTMLTextAreaElement, "Prefer numbered steps.");
};
const editAndSave: NonNullable<SkinCase["drive"]> = async (mounted) => {
  await edit(mounted);
  click(saveButton(mounted.container));
  await settle();
};

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  ready: { arrange: () => preferences.reset(), ui },
  "ready-empty": {
    arrange: () => {
      preferences.reset();
      preferences.saved = savedPreferences("");
    },
    ui,
  },
  loading: {
    arrange: () => {
      preferences.reset();
      preferences.isLoading = true;
    },
    ui,
  },
  "load-error": {
    arrange: () => {
      preferences.reset();
      preferences.isError = true;
      preferences.saved = undefined;
    },
    ui,
  },
  editing: { arrange: () => preferences.reset(), ui, drive: edit },
  "save-error": {
    arrange: () => {
      preferences.reset();
      preferences.mutateAsync.mockRejectedValueOnce({
        actionMessage: "Preferences changed. Reload before saving.",
      });
    },
    ui,
    drive: editAndSave,
  },
  saved: { arrange: () => preferences.reset(), ui, drive: editAndSave },
};

describe("account preferences, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    expect(await skinDifferences(STATES[name]!)).toEqual([]);
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(() => preferences.reset());

    it("edits and saves against the revision the edit started from", async () => {
      const mounted = mount(ui(), skin);
      try {
        tagged(mounted.container, ROW, "settings.row");
        expect(control(mounted.container).tagName).toBe("BUTTON");
        await editAndSave(mounted);
        expect(preferences.mutateAsync).toHaveBeenCalledWith({
          content: "Prefer numbered steps.",
          expectedOwner: "owner@example.test",
          expectedRevision: { id: "personal-guidance", updatedAt: 12 },
        });
        // The edit is over: the control is the edit button again.
        expect(control(mounted.container).tagName).toBe("BUTTON");
        expect(
          tagged(mounted.container, ROW, "settings.row.value").textContent,
        ).toBe("Prefer numbered steps.");
      } finally {
        mounted.unmount();
      }
    });

    it("keeps the draft and shows the message when the save fails", async () => {
      preferences.mutateAsync.mockRejectedValueOnce({
        actionMessage: "Preferences changed. Reload before saving.",
      });
      const mounted = mount(ui(), skin);
      try {
        await editAndSave(mounted);
        expect((control(mounted.container) as HTMLTextAreaElement).value).toBe(
          "Prefer numbered steps.",
        );
        expect(
          tagged(mounted.container, ROW, "settings.row.error").textContent,
        ).toBe("Preferences changed. Reload before saving.");
      } finally {
        mounted.unmount();
      }
    });

    it("loads again after a failed load", () => {
      preferences.isError = true;
      preferences.saved = undefined;
      const mounted = mount(ui(), skin);
      try {
        click(retry(mounted.container));
        expect(preferences.refetch).toHaveBeenCalledTimes(1);
      } finally {
        mounted.unmount();
      }
    });
  });
});
