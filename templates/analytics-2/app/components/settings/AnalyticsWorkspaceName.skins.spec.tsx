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

import { workspaceName } from "./AnalyticsWorkspaceName.fixtures";

const { skinDifferences } = createSkinHarness({ referenceDesignSystem, mount });

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  ...(await import("./AnalyticsWorkspaceName.fixtures")).workspaceNameHooksMock,
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));
vi.mock(
  "sonner",
  async () =>
    (await import("./AnalyticsWorkspaceName.fixtures")).workspaceNameToastMock,
);

const { AnalyticsWorkspaceName } = await import("./AnalyticsWorkspaceName");

const NAME = "settings.general.workspace-name";

const ui = () => <AnalyticsWorkspaceName />;
const field = () =>
  partControl(
    document,
    `${NAME}.dialog.name`,
    "settings.dialog.field",
  ) as HTMLInputElement;
const confirm = () =>
  partControl(document, `${NAME}.dialog.confirm`, "settings.dialog.action");
const open: NonNullable<SkinCase["drive"]> = async ({ container }) => {
  click(rowControl(container, NAME));
  await settle();
};
const save = async () => {
  click(confirm());
  await settle();
};

/** The states of the golden spec, by the same names. */
const STATES: Record<string, SkinCase> = {
  ready: { arrange: () => workspaceName.reset(), ui },
  "ready-labelled": {
    arrange: () => workspaceName.reset(),
    ui: () => <AnalyticsWorkspaceName editLabel="Edit workspace name" />,
  },
  "read-only": {
    arrange: () => {
      workspaceName.reset();
      workspaceName.data = {
        orgId: "org-1",
        name: "Acme Analytics",
        canEdit: false,
      };
    },
    ui,
  },
  loading: {
    arrange: () => {
      workspaceName.reset();
      workspaceName.isLoading = true;
    },
    ui,
  },
  "load-error": {
    arrange: () => {
      workspaceName.reset();
      workspaceName.isError = true;
      workspaceName.data = undefined;
    },
    ui,
  },
  dialog: {
    arrange: () => workspaceName.reset(),
    ui: () => <AnalyticsWorkspaceName editLabel="Edit workspace name" />,
    drive: open,
    document: true,
  },
  "dialog-blank": {
    arrange: () => workspaceName.reset(),
    ui,
    drive: async (mounted) => {
      await open(mounted);
      type(field(), "   ");
    },
    document: true,
  },
  "dialog-save-error": {
    arrange: () => {
      workspaceName.reset();
      workspaceName.mutateAsync.mockRejectedValueOnce({
        actionMessage: "The workspace changed. Reload before saving.",
      });
    },
    ui,
    drive: async (mounted) => {
      await open(mounted);
      type(field(), "Acme Data");
      await save();
    },
    document: true,
  },
  saved: {
    arrange: () => workspaceName.reset(),
    ui,
    drive: async (mounted) => {
      await open(mounted);
      type(field(), "  Acme Data  ");
      await save();
      await settle();
    },
    document: true,
  },
};

describe("workspace name, both skins", () => {
  it.each(Object.keys(STATES))("%s: the skins agree", async (name) => {
    expect(await skinDifferences(STATES[name]!)).toEqual([]);
  });

  describe.each(SKINS)("journeys in the %s skin", (_name, skin) => {
    beforeEach(() => workspaceName.reset());

    it("opens the dialog on the current name, saves a new one and closes", async () => {
      const mounted = mount(ui(), skin);
      try {
        await open(mounted);
        tagged(document, `${NAME}.dialog`, "settings.dialog");
        expect(field().value).toBe("Acme Analytics");
        type(field(), "  Acme Data  ");
        await save();
        expect(workspaceName.mutateAsync).toHaveBeenCalledWith({
          name: "Acme Data",
          expectedOrgId: "org-1",
        });
        expect(workspaceName.refetch).toHaveBeenCalledTimes(1);
        expect(workspaceName.toastSuccess).toHaveBeenCalledWith(
          "Workspace name updated",
        );
        await settle();
        expect(
          document.querySelector(`[data-rid="${NAME}.dialog.name"]`),
        ).toBeNull();
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("keeps the dialog open with the message when the save fails", async () => {
      workspaceName.mutateAsync.mockRejectedValueOnce({
        actionMessage: "The workspace changed. Reload before saving.",
      });
      const mounted = mount(ui(), skin);
      try {
        await open(mounted);
        type(field(), "Acme Data");
        await save();
        expect(field().value).toBe("Acme Data");
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(
          "The workspace changed. Reload before saving.",
        );
        expect(workspaceName.toastSuccess).not.toHaveBeenCalled();
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("does not open for someone who cannot edit", async () => {
      workspaceName.data = {
        orgId: "org-1",
        name: "Acme Analytics",
        canEdit: false,
      };
      const mounted = mount(ui(), skin);
      try {
        expect(
          rowControl(mounted.container, NAME).hasAttribute("disabled"),
        ).toBe(true);
        await open(mounted);
        expect(
          document.querySelector(`[data-rid="${NAME}.dialog.name"]`),
        ).toBeNull();
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });

    it("offers to load the name again when it could not be loaded", () => {
      workspaceName.isError = true;
      workspaceName.data = undefined;
      const mounted = mount(ui(), skin);
      try {
        expect(
          mounted.container.querySelector(`[data-rid="${NAME}"]`),
        ).toBeNull();
        // A section's retry belongs to no row, so it has no row id.
        click(
          mounted.container.querySelector(
            '[role="alert"] button',
          ) as HTMLButtonElement,
        );
        expect(workspaceName.refetch).toHaveBeenCalledTimes(1);
      } finally {
        mounted.unmount();
        document.body.innerHTML = "";
      }
    });
  });
});
