// @vitest-environment happy-dom

import {
  snapshotSettings,
  type SettingsBehaviorWitness,
  type SettingsSkinChoice,
} from "@agent-native/toolkit/app/settings/rows/snapshot";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle, type } from "@/skins/reference/testing/mount";
import { SKINS, partControl, tagged } from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

import {
  CATEGORIES,
  STATUSES,
  assetLabels,
  labelRoute,
} from "./AnalyticsAssetLabelsSettings.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsAssetLabelsSettings.fixtures"))
    .assetLabelHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));

const { AnalyticsAssetLabelsSettings } =
  await import("./AnalyticsAssetLabelsSettings");

const STATUS_ROW = "settings.asset-statuses.statuses";
const CATEGORY_ROW = "settings.asset-categories.categories";

const page = (view: "asset-statuses" | "asset-categories") => () => (
  <QueryClientProvider client={new QueryClient()}>
    <AnalyticsAssetLabelsSettings route={labelRoute(view)} />
  </QueryClientProvider>
);
const statuses = page("asset-statuses");
const categories = page("asset-categories");

/**
 * The add form. One skin keeps it open under the list; the other opens it from
 * an add control, in a dialog. `openAdd` presses that control where there is
 * one, and the form's parts are then looked for in the whole document.
 */
const openAdd = async (root: ParentNode, row: string) => {
  const add = root.querySelector(
    `[data-rid="${row}.add"][data-part="settings.collection.add"]`,
  );
  if (add) {
    click(add.matches("button") ? add : add.querySelector("button")!);
    await settle();
  }
};
const nameField = (row: string) =>
  partControl(
    document,
    `${row}.add.name`,
    "settings.collection.field",
  ) as HTMLInputElement;
/**
 * Picks a color by its place in the fixed list: the swatch at that place, or
 * that option of the field's menu where the field is drawn as one.
 */
const pickColor = async (row: string, index: number) => {
  const field = tagged(
    document,
    `${row}.add.color`,
    "settings.collection.field",
  );
  const menu = field.querySelector('[role="combobox"]');
  if (!menu) {
    click(field.querySelectorAll("button")[index]!);
    return;
  }
  click(menu);
  await settle();
  act(() => {
    document
      .querySelectorAll('[role="option"]')
      [index]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });
  await settle();
};
const submit = (row: string) =>
  partControl(document, `${row}.add.submit`, "settings.dialog.action");
const remove = (root: ParentNode, row: string, key: string) =>
  partControl(root, `${row}.item.remove`, "settings.collection.action", key);

const withStatuses = () => {
  assetLabels.reset();
  assetLabels.statuses = STATUSES;
};

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  "statuses.empty": { arrange: () => assetLabels.reset(), ui: statuses },
  "statuses.admin": { arrange: withStatuses, ui: statuses },
  "statuses.member": {
    arrange: () => {
      withStatuses();
      assetLabels.isAdmin = false;
    },
    ui: statuses,
  },
  "statuses.form-filled": {
    arrange: withStatuses,
    ui: statuses,
    drive: async ({ container }) => {
      await openAdd(container, STATUS_ROW);
      type(nameField(STATUS_ROW), "In review");
      await pickColor(STATUS_ROW, 5);
    },
    document: true,
  },
  "statuses.added": {
    arrange: withStatuses,
    ui: statuses,
    drive: async ({ container }) => {
      await openAdd(container, STATUS_ROW);
      type(nameField(STATUS_ROW), "  In review  ");
      await pickColor(STATUS_ROW, 5);
      click(submit(STATUS_ROW));
      await settle();
    },
    document: true,
  },
  "statuses.create-error": {
    arrange: () => {
      withStatuses();
      assetLabels.callAction.mockRejectedValueOnce(
        new Error("A status with that name already exists."),
      );
    },
    ui: statuses,
    drive: async ({ container }) => {
      await openAdd(container, STATUS_ROW);
      type(nameField(STATUS_ROW), "Draft");
      click(submit(STATUS_ROW));
      await settle();
    },
    document: true,
  },
  "statuses.removed": {
    arrange: withStatuses,
    ui: statuses,
    drive: async ({ container }) => {
      click(remove(container, STATUS_ROW, "status-2"));
      await settle();
    },
  },
  "categories.empty": { arrange: () => assetLabels.reset(), ui: categories },
  "categories.admin": {
    arrange: () => {
      assetLabels.reset();
      assetLabels.categories = CATEGORIES;
    },
    ui: categories,
  },
  "categories.member": {
    arrange: () => {
      assetLabels.reset();
      assetLabels.isAdmin = false;
      assetLabels.categories = CATEGORIES;
    },
    ui: categories,
  },
  "categories.create-error": {
    arrange: () => {
      assetLabels.reset();
      assetLabels.callAction.mockRejectedValueOnce("offline");
    },
    ui: categories,
    drive: async ({ container }) => {
      await openAdd(container, CATEGORY_ROW);
      type(nameField(CATEGORY_ROW), "Finance");
      click(submit(CATEGORY_ROW));
      await settle();
    },
    document: true,
  },
};

const formChoices = (row: string): SettingsSkinChoice[] => [
  {
    rid: `${row}.add.color`,
    key: null,
    referenceFamily: "swatches",
    houseFamily: "select",
    reason: "The same named colors are selected through swatches or a menu.",
  },
  {
    rid: `${row}.add.submit`,
    key: null,
    referenceFamily: "inline-form",
    houseFamily: "dialog-form",
    reason: "The same add operation is exposed inline or in a dialog.",
  },
];

async function exposeForm({ container }: { container: HTMLDivElement }) {
  const holder = container.querySelector<HTMLElement>(
    '[data-part="settings.collection.add"]',
  );
  if (!holder) return;
  const opener = holder.matches("button")
    ? holder
    : holder.querySelector<HTMLButtonElement>("button")!;
  const row = holder.getAttribute("data-rid")!.replace(/\.add$/, "");
  expect(opener.textContent).toBe(
    row === STATUS_ROW ? "New status" : "New category",
  );
  expect(opener.hasAttribute("disabled")).toBe(false);
  if (!document.querySelector(`[data-rid="${row}.add.submit"]`)) {
    opener.focus();
    expect(document.activeElement).toBe(opener);
    expect(opener.tabIndex).toBeGreaterThanOrEqual(0);
    // Native button keyboard activation dispatches click in the browser.
    opener.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    click(opener);
    await settle();
  }
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(submit(row)).toBeDefined();
  return [
    {
      rid: `${row}.add`,
      key: null,
      operationRid: `${row}.add.submit`,
      operationKey: null,
    },
  ];
}

async function formEvidence(
  _mounted: unknown,
  entries: ReturnType<typeof snapshotSettings>,
  skin: "reference" | "house",
) {
  const color = entries.find((entry) => entry.rid.endsWith(".add.color"));
  if (!color) return;
  expect(color.name).toBe(skin === "house" ? "Color" : "Use #d64545");
  const row = color.rid.replace(/\.add.color$/, "");
  const readColors = async () => {
    const field = tagged(document, color.rid, "settings.collection.field");
    const menu = field.querySelector<HTMLElement>('[role="combobox"]');
    expect(Boolean(menu)).toBe(skin === "house");
    if (menu) {
      click(menu);
      await settle();
      const choices = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].map((option) => ({
        value:
          option.getAttribute("data-key") ??
          option.textContent!.trim().replace(/^Use /, ""),
        label: option.textContent!.trim(),
        enabled: option.getAttribute("aria-disabled") !== "true",
      }));
      const selected = document.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      );
      const value =
        selected?.textContent!.trim().replace(/^Use /, "") ??
        menu.textContent!.trim().replace(/^Use /, "");
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await settle();
      return { value, choices, control: menu };
    }
    const swatches = [...field.querySelectorAll<HTMLButtonElement>("button")];
    const choices = swatches.map((button) => ({
      value: button.getAttribute("aria-label")!.replace(/^Use /, ""),
      label: button.getAttribute("aria-label")!,
      enabled: !button.disabled,
    }));
    return {
      value: swatches
        .find((button) => button.getAttribute("aria-pressed") === "true")!
        .getAttribute("aria-label")!
        .replace(/^Use /, ""),
      choices,
      control: swatches[0]!,
    };
  };
  const observed = await readColors();
  observed.control.focus();
  const reachable =
    document.activeElement === observed.control &&
    observed.control.tabIndex >= 0 &&
    !observed.control.closest("[hidden], [inert], [aria-hidden=true]");
  const action = entries.find((entry) => entry.rid === `${row}.add.submit`)!;
  const error =
    entries.find((entry) => entry.rid === `${row}.add.error`)?.error ?? null;
  const initialSubmit = submit(row);
  expect(
    initialSubmit.closest(skin === "reference" ? "form" : '[role="dialog"]'),
  ).not.toBeNull();
  if (action.enabled) initialSubmit.focus();
  const submitReachable =
    action.enabled &&
    document.activeElement === initialSubmit &&
    initialSubmit.tabIndex >= 0;
  type(nameField(row), "Witness entry");
  await pickColor(row, 1);
  const changed = await readColors();
  const before = assetLabels.callAction.mock.calls.length;
  click(submit(row));
  await settle();
  const call = assetLabels.callAction.mock.calls[before];
  expect(call).toBeDefined();
  expect(document.querySelector(`[data-rid="${row}.add.error"]`)).toBeNull();
  const effect = { kind: "write" as const, target: call![0], result: call![1] };
  const witnesses: SettingsBehaviorWitness[] = [
    {
      rid: color.rid,
      key: null,
      name: color.name,
      value: observed.value,
      choices: observed.choices,
      enabled: color.enabled,
      checked: null,
      effect: { kind: "write", target: color.rid, result: changed.value },
      error,
      recovery: null,
      keyboard: {
        reachable,
        operable: changed.value === observed.choices[1]!.value,
      },
    },
    {
      rid: action.rid,
      key: null,
      name: action.name,
      value: action.value,
      choices: [],
      enabled: action.enabled,
      checked: null,
      effect,
      error,
      recovery: error ? effect : null,
      keyboard: {
        reachable: submitReachable,
        operable: action.enabled && call !== undefined,
      },
    },
  ];
  return { skinChoices: formChoices(row), witnesses };
}

describe("asset labels, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    const row = name.startsWith("statuses.") ? STATUS_ROW : CATEGORY_ROW;
    expect(
      await skinDifferences({
        ...STATES[name]!,
        expose: exposeForm,
        evidence: formEvidence,
      }),
    ).toEqual(
      name.endsWith(".member")
        ? []
        : [
            `${row}.add.color: name ${JSON.stringify("Use #d64545")} (reference) vs ${JSON.stringify("Color")} (house)`,
          ],
    );
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(() => assetLabels.reset());

    it("adds a status with a trimmed name and the picked color, and keeps the color for the next one", async () => {
      assetLabels.statuses = STATUSES;
      const mounted = mount(statuses(), skin);
      try {
        const { container } = mounted;
        await openAdd(container, STATUS_ROW);
        expect(submit(STATUS_ROW).hasAttribute("disabled")).toBe(true);
        type(nameField(STATUS_ROW), "   ");
        expect(submit(STATUS_ROW).hasAttribute("disabled")).toBe(true);
        type(nameField(STATUS_ROW), "  In review  ");
        await pickColor(STATUS_ROW, 5);
        click(submit(STATUS_ROW));
        await settle();
        expect(assetLabels.callAction).toHaveBeenLastCalledWith(
          "create-data-status",
          { name: "In review", color: "#3f6fb5" },
        );
        await openAdd(container, STATUS_ROW);
        expect(nameField(STATUS_ROW).value).toBe("");
        type(nameField(STATUS_ROW), "Retired");
        click(submit(STATUS_ROW));
        await settle();
        expect(assetLabels.callAction).toHaveBeenLastCalledWith(
          "create-data-status",
          { name: "Retired", color: "#3f6fb5" },
        );
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("keeps the form and shows the message when a category is not created", async () => {
      assetLabels.callAction.mockRejectedValueOnce(
        new Error("A category with that name already exists."),
      );
      const mounted = mount(categories(), skin);
      try {
        await openAdd(mounted.container, CATEGORY_ROW);
        type(nameField(CATEGORY_ROW), "Finance");
        click(submit(CATEGORY_ROW));
        await settle();
        expect(
          tagged(
            document,
            `${CATEGORY_ROW}.add.error`,
            "settings.collection.error",
          ).textContent,
        ).toBe("A category with that name already exists.");
        expect(nameField(CATEGORY_ROW).value).toBe("Finance");
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("removes one category by its key", async () => {
      assetLabels.categories = CATEGORIES;
      const mounted = mount(categories(), skin);
      try {
        expect(
          tagged(
            mounted.container,
            `${CATEGORY_ROW}.item`,
            "settings.collection.item",
            "category-2",
          ).textContent,
        ).toContain("Growth");
        click(remove(mounted.container, CATEGORY_ROW, "category-2"));
        await settle();
        expect(assetLabels.callAction).toHaveBeenCalledWith(
          "delete-data-category",
          { id: "category-2" },
        );
      } finally {
        mounted.unmount();
      }
    });

    it("shows a member the list with nothing to add or remove", () => {
      assetLabels.isAdmin = false;
      assetLabels.statuses = STATUSES;
      const mounted = mount(statuses(), skin);
      try {
        const { container } = mounted;
        tagged(container, STATUS_ROW, "settings.row");
        expect(
          container.querySelectorAll('[data-part="settings.collection.item"]'),
        ).toHaveLength(3);
        expect(
          container.querySelector('[data-part="settings.collection.action"]'),
        ).toBeNull();
        expect(
          container.querySelector('[data-part="settings.collection.field"]'),
        ).toBeNull();
        expect(
          container.querySelector('[data-part="settings.collection.add"]'),
        ).toBeNull();
        expect(
          container.querySelector(`[data-rid="${CATEGORY_ROW}"]`),
        ).toBeNull();
      } finally {
        mounted.unmount();
      }
    });
  });
});
