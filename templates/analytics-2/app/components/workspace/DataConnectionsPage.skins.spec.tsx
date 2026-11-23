// @vitest-environment happy-dom

import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import {
  BROWSER,
  SALES,
  TABLE,
  add,
  remaining,
  run,
  createConnectionSkinHarness,
} from "@/components/data/WorkspaceDataConnections.skin-helpers";
import { referenceDesignSystem } from "@/skins/reference/design-system";
import { click, mount, settle } from "@/skins/reference/testing/mount";
import { SKINS, rowControl, tagged } from "@/skins/reference/testing/skins";
import { createSkinHarness, type SkinCase } from "@/testing/settings/skins";

const { exposeActions, actionEvidence } = createConnectionSkinHarness(settle);
const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

vi.mock(
  "@/components/data/useDataConnectionActions",
  async () =>
    (await import("@/components/data/WorkspaceDataConnections.fixtures"))
      .dataConnectionActionsMock,
);
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useNavigate: () => dataConnections.navigate,
}));

const { DataConnectionsPage } = await import("./DataConnectionsPage");

const ui = () => (
  <MemoryRouter>
    <DataConnectionsPage />
  </MemoryRouter>
);
const reset = () => dataConnections.reset();
/**
 * The connection dialog belongs to a component this conversion does not own,
 * so what is inside it carries no row id: its close button is found by its
 * label and a type card by the type's name.
 */
const closeDialog = () =>
  document.querySelector('[aria-label="Close"]') as HTMLButtonElement;
const typeCard = (name: string) =>
  [...document.querySelectorAll('[role="dialog"] button')].find((button) =>
    button.textContent?.includes(name),
  ) as HTMLButtonElement;
const openAdd: NonNullable<SkinCase["drive"]> = async ({ container }) => {
  click(add(container));
  await settle();
};
const openEdit: NonNullable<SkinCase["drive"]> = async ({ container }) => {
  run(container, SALES, "edit");
  await settle();
};

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  ready: { arrange: reset, ui },
  loading: {
    arrange: () => {
      reset();
      dataConnections.isPending = true;
    },
    ui,
  },
  error: {
    arrange: () => {
      reset();
      dataConnections.isError = true;
      dataConnections.connections = [];
    },
    ui,
  },
  empty: {
    arrange: () => {
      reset();
      dataConnections.connections = [];
    },
    ui,
  },
  "add-dialog": { arrange: reset, ui, drive: openAdd, document: true },
  "add-dialog-closed": {
    arrange: reset,
    ui,
    drive: async (mounted) => {
      await openAdd(mounted);
      click(closeDialog());
      await settle();
    },
    document: true,
  },
  "add-dialog-form": {
    arrange: reset,
    ui,
    drive: async (mounted) => {
      await openAdd(mounted);
      click(typeCard("Google BigQuery"));
      await settle();
    },
    document: true,
  },
  "edit-dialog": { arrange: reset, ui, drive: openEdit, document: true },
  "edit-error": {
    arrange: () => {
      reset();
      dataConnections.getForm.mockRejectedValueOnce(
        new Error("The connection is locked."),
      );
    },
    ui,
    drive: openEdit,
  },
  "edit-error-unknown": {
    arrange: () => {
      reset();
      dataConnections.getForm.mockRejectedValueOnce("offline");
    },
    ui,
    drive: openEdit,
  },
  "edit-error-cleared": {
    arrange: () => {
      reset();
      dataConnections.getForm.mockRejectedValueOnce("offline");
    },
    ui,
    drive: async (mounted) => {
      await openEdit(mounted);
      await openAdd(mounted);
      click(closeDialog());
      await settle();
    },
  },
};

/** The panel's exact sort-state differences remain in every applicable state. */
const REMAINING: Record<string, string[]> = {
  ready: remaining(),
  loading: remaining({ keys: [] }),
  error: remaining({ keys: [], sorted: null }),
  empty: remaining({ keys: [] }),
  "add-dialog": remaining(),
  "add-dialog-closed": remaining(),
  "add-dialog-form": remaining(),
  "edit-dialog": remaining(),
  // The edit that could not be opened closed the menu it was started from.
  "edit-error": remaining(),
  "edit-error-unknown": remaining(),
  "edit-error-cleared": remaining(),
};

describe("data sources page, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    // The lines are exact; their order follows where each skin draws things.
    expect(
      (
        await skinDifferences({
          ...STATES[name]!,
          expose: exposeActions,
          evidence: (mounted, entries, skin) =>
            actionEvidence(mounted, entries, skin, true),
        })
      ).sort(),
    ).toEqual([...REMAINING[name]!].sort());
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(reset);

    it("lists only backed connection types and returns to the picker", async () => {
      const mounted = mount(ui(), skin);
      try {
        await openAdd(mounted);
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(typeCard("Google BigQuery")).toBeDefined();
        expect(typeCard("Snowflake")).toBeUndefined();
        expect(dataConnections.save).not.toHaveBeenCalled();
        click(closeDialog());
        await settle();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("opens the same dialog from an item's edit, once that connection's form is read", async () => {
      const mounted = mount(ui(), skin);
      try {
        const row = tagged(
          mounted.container,
          `${TABLE}.item`,
          "settings.collection.item",
          SALES,
        );
        run(row, SALES, "edit");
        await settle();
        expect(dataConnections.getForm).toHaveBeenCalledWith(SALES);
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        // An edit opens on the connection's form, not on the type picker.
        expect(typeCard("Google BigQuery")).toBeUndefined();
        click(closeDialog());
        await settle();
        await openAdd(mounted);
        expect(typeCard("Google BigQuery")).toBeDefined();
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("says why an edit could not be opened, and clears it when the dialog next closes", async () => {
      dataConnections.getForm.mockRejectedValueOnce(
        new Error("The connection is locked."),
      );
      const mounted = mount(ui(), skin);
      try {
        await openEdit(mounted);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(mounted.container.textContent).toContain(
          "The connection is locked.",
        );
        await openAdd(mounted);
        click(closeDialog());
        await settle();
        expect(mounted.container.textContent).not.toContain(
          "The connection is locked.",
        );
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("leads to the data browser", () => {
      const mounted = mount(ui(), skin);
      try {
        const control = rowControl(mounted.container, BROWSER);
        // One skin draws a button that asks the router, the other a link.
        if (control.hasAttribute("href")) {
          expect(control.getAttribute("href")).toBe("/home/data");
        } else {
          click(control);
          expect(dataConnections.navigate).toHaveBeenCalledWith("/home/data");
        }
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });
  });
});
