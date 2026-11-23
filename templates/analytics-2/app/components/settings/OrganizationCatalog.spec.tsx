// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: true,
  statusError: false,
  archiveError: false,
  retry: vi.fn(),
  call: vi.fn(),
  statuses: [{ id: "s", name: "Draft", color: null }],
  archive: { noEditArchiveCadence: 90, noViewArchiveCadence: null } as {
    noEditArchiveCadence: number | null;
    noViewArchiveCadence: number | null;
  },
}));
vi.mock("@agent-native/toolkit/app/org", () => ({
  OrgGeneralPage: () => <div>Organization general</div>,
  OrgAuthenticationPage: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: state.call,
  useActionQuery: (name: string) => ({
    data:
      name === "get-workspace-bootstrap"
        ? { features: { isAdmin: state.admin } }
        : name === "get-organization-archive-settings"
          ? state.archiveError
            ? undefined
            : state.archive
          : name === "list-data-statuses"
            ? state.statusError
              ? undefined
              : { statuses: state.statuses }
            : { categories: [{ id: "c", name: "Finance", color: null }] },
    isLoading: false,
    isError:
      (name === "list-data-statuses" && state.statusError) ||
      (name === "get-organization-archive-settings" && state.archiveError),
    refetch: state.retry,
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  ...(await import("@/skins/reference/testing/i18n")).i18nMock,
}));
import { OrganizationSettingsPage } from "./SettingsShellBridgedPages";
describe("report1795030602", () => {
  const mount = () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/settings/organization"]}>
            <OrganizationSettingsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    return {
      host,
      close: () => {
        act(() => root.unmount());
        host.remove();
      },
    };
  };
  it("offers a default status selector for new projects", () => {
    state.admin = true;
    state.statusError = false;
    const { host, close } = mount();
    try {
      expect(host.textContent).toContain(
        "Set a default status for new projects",
      );
      expect(host.textContent).toContain("No status");
    } finally {
      close();
    }
  });
  it("shows both organization catalogs on the organization route", () => {
    state.admin = true;
    state.statusError = false;
    const { host, close } = mount();
    try {
      expect(host.textContent).toContain("Asset status");
      expect(host.textContent).toContain("Asset categories");
      expect(
        Array.from(host.querySelectorAll("h2")).map((h) => h.textContent),
      ).toEqual(expect.arrayContaining(["Asset status", "Asset categories"]));
      expect(host.textContent).toContain("Draft");
      expect(host.textContent).toContain("Finance");
    } finally {
      close();
    }
  });
  it("offers auto-archive criteria before the asset catalogs", () => {
    state.admin = true;
    state.statusError = false;
    const { host, close } = mount();
    try {
      const headings = Array.from(host.querySelectorAll("h2")).map(
        (h) => h.textContent,
      );
      expect(headings).toEqual(
        expect.arrayContaining([
          "Auto-archive",
          "Asset status",
          "Asset categories",
        ]),
      );
      expect(headings.indexOf("Auto-archive")).toBeLessThan(
        headings.indexOf("Asset status"),
      );
      expect(host.textContent).toContain("have not been edited for");
      expect(host.textContent).toContain("have not been viewed for");
      const toggles = Array.from(
        host.querySelectorAll("[role=switch], input[type=checkbox]"),
      ).filter((el) =>
        /edited|viewed/.test(el.getAttribute("aria-label") ?? ""),
      );
      expect(toggles).toHaveLength(2);
      const days = host.querySelector("input[type=number]") as HTMLInputElement;
      expect(days?.value).toBe("90");
    } finally {
      close();
    }
  });
  it("saves a cadence change through the archive settings action", async () => {
    state.admin = true;
    state.statusError = false;
    state.call.mockReset();
    state.call.mockResolvedValue({});
    const { host, close } = mount();
    try {
      const viewed = Array.from(
        host.querySelectorAll("[role=switch], input[type=checkbox]"),
      ).find((el) =>
        /viewed/.test(el.getAttribute("aria-label") ?? ""),
      ) as HTMLElement;
      expect(viewed).toBeTruthy();
      await act(async () => viewed.click());
      expect(state.call).toHaveBeenCalledWith(
        "save-organization-archive-settings",
        {
          noEditArchiveCadence: 90,
          noViewArchiveCadence: 365,
        },
      );
    } finally {
      close();
    }
  });
  it("preserves both rapid archive toggles when the first save is still in flight", async () => {
    state.admin = true;
    state.statusError = false;
    state.archiveError = false;
    state.archive = { noEditArchiveCadence: 90, noViewArchiveCadence: null };
    state.call.mockReset();
    let resolveFirst!: (value: unknown) => void;
    state.call
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({});
    const { host, close } = mount();
    try {
      const toggles = Array.from(
        host.querySelectorAll<HTMLElement>(
          "[role=switch], input[type=checkbox]",
        ),
      );
      const edited = toggles.find((el) =>
        /edited/.test(el.getAttribute("aria-label") ?? ""),
      )!;
      const viewed = toggles.find((el) =>
        /viewed/.test(el.getAttribute("aria-label") ?? ""),
      )!;
      await act(async () => {
        edited.click();
      });
      await act(async () => {
        viewed.click();
      });
      await act(async () => {
        resolveFirst({});
      });
      expect(state.call).toHaveBeenCalledTimes(2);
      expect(state.call).toHaveBeenNthCalledWith(
        1,
        "save-organization-archive-settings",
        {
          noEditArchiveCadence: null,
          noViewArchiveCadence: null,
        },
      );
      expect(state.call).toHaveBeenNthCalledWith(
        2,
        "save-organization-archive-settings",
        {
          noEditArchiveCadence: null,
          noViewArchiveCadence: 365,
        },
      );
    } finally {
      close();
    }
  });
  it("keeps member catalogs readable without mutation controls", () => {
    state.admin = false;
    state.statusError = false;
    const { host, close } = mount();
    try {
      expect(host.textContent).toContain("Draft");
      expect(host.textContent).toContain("Finance");
      expect(host.textContent).not.toContain("New status");
      expect(host.textContent).not.toContain("Remove");
    } finally {
      close();
    }
  });
  it("shows a retry for one failed list while the other stays visible", () => {
    state.admin = true;
    state.statusError = true;
    state.retry.mockClear();
    const { host, close } = mount();
    try {
      expect(host.textContent).toContain("Could not load this list.");
      expect(host.textContent).toContain("Finance");
      const retry = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Retry",
      );
      expect(retry).toBeDefined();
      act(() => retry?.click());
      expect(state.retry).toHaveBeenCalledOnce();
    } finally {
      close();
    }
  });
  it("blocks archive editing and offers a working retry when the settings fail to load", () => {
    state.admin = true;
    state.statusError = false;
    state.archiveError = true;
    state.retry.mockClear();
    state.call.mockClear();
    const { host, close } = mount();
    try {
      const alert = host.querySelector(
        'section[aria-label="Auto-archive"] [role="alert"]',
      );
      expect(alert?.textContent).toContain("Could not load this list.");
      expect(
        host.querySelectorAll(
          'section[aria-label="Auto-archive"] [role=switch], section[aria-label="Auto-archive"] input',
        ),
      ).toHaveLength(0);
      const retry = Array.from(
        alert?.parentElement?.querySelectorAll("button") ?? [],
      ).find((button) => button.textContent === "Retry");
      expect(retry).toBeDefined();
      act(() => retry?.click());
      expect(state.retry).toHaveBeenCalledOnce();
      expect(state.call).not.toHaveBeenCalled();
    } finally {
      state.archiveError = false;
      close();
    }
  });
  function openMenu(host: HTMLElement) {
    const menu = host.querySelector(
      'button[aria-label="Actions for Draft"]',
    ) as HTMLButtonElement;
    expect(menu).toBeTruthy();
    act(() =>
      menu.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
  }
  it("requires confirmation before removing a catalog entry", () => {
    state.admin = true;
    state.statusError = false;
    state.call.mockClear();
    const { host, close } = mount();
    try {
      openMenu(host);
      const remove = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).find((item) => item.textContent === "Delete...") as HTMLElement;
      expect(remove).toBeTruthy();
      act(() => remove.click());
      expect(document.body.textContent).toContain("Confirm delete");
      expect(document.body.textContent).toContain("Delete status Draft?");
      expect(state.call).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
  it("opens the existing status in an editable form", () => {
    state.admin = true;
    state.statusError = false;
    const { host, close } = mount();
    try {
      openMenu(host);
      const edit = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).find((item) => item.textContent === "Edit...") as HTMLElement;
      expect(edit).toBeTruthy();
      act(() => edit.click());
      expect(document.body.textContent).toContain("Update status");
      expect(
        (document.querySelector('input[value="Draft"]') as HTMLInputElement)
          ?.value,
      ).toBe("Draft");
    } finally {
      close();
    }
  });
  it("persists status order after a drag", async () => {
    state.admin = true;
    state.statusError = false;
    state.statuses = [
      { id: "s", name: "Draft", color: null },
      { id: "t", name: "Ready", color: null },
    ];
    state.call.mockResolvedValue({});
    const { host, close } = mount();
    try {
      const draft = host.querySelector('[aria-label="Reorder Draft"]');
      const ready = host.querySelector('[aria-label="Reorder Ready"]');
      expect(draft).toBeTruthy();
      expect(ready).toBeTruthy();
      if (!draft || !ready) throw new Error("Missing drag controls");
      await act(async () => {
        ready.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            dataTransfer: new DataTransfer(),
          }),
        );
        draft.dispatchEvent(
          new Event("dragover", { bubbles: true, cancelable: true }),
        );
        draft.dispatchEvent(
          new Event("drop", { bubbles: true, cancelable: true }),
        );
      });
      expect(state.call).toHaveBeenCalledWith("reorder-data-status", {
        ids: ["t", "s"],
      });
    } finally {
      close();
      state.statuses = [{ id: "s", name: "Draft", color: null }];
    }
  });
  it("restores the prior status order when a reorder fails", async () => {
    state.admin = true;
    state.statusError = false;
    state.statuses = [
      { id: "s", name: "Draft", color: null },
      { id: "t", name: "Ready", color: null },
    ];
    state.call.mockRejectedValueOnce(new Error("offline"));
    const { host, close } = mount();
    try {
      const draft = host.querySelector('[aria-label="Reorder Draft"]');
      const ready = host.querySelector('[aria-label="Reorder Ready"]');
      if (!draft || !ready) throw new Error("Missing drag controls");
      await act(async () => {
        ready.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            dataTransfer: new DataTransfer(),
          }),
        );
        draft.dispatchEvent(
          new Event("dragover", { bubbles: true, cancelable: true }),
        );
        draft.dispatchEvent(
          new Event("drop", { bubbles: true, cancelable: true }),
        );
      });
      expect(host.textContent).toContain("Failed to reorder status.");
      const handles = Array.from(host.querySelectorAll('[draggable="true"]'));
      expect(
        handles.map((handle) => handle.getAttribute("aria-label")),
      ).toEqual(["Reorder Draft", "Reorder Ready"]);
    } finally {
      close();
      state.statuses = [{ id: "s", name: "Draft", color: null }];
    }
  });
  it("exposes section anchor ids and documents collection exemption for auto-archive", () => {
    state.admin = true;
    state.statusError = false;
    state.archiveError = false;
    const { host, close } = mount();
    try {
      const autoArchive = host.querySelector(
        "#settings-organization-auto-archive",
      );
      const statuses = host.querySelector("#settings-organization-statuses");
      const categories = host.querySelector(
        "#settings-organization-categories",
      );
      expect(autoArchive).not.toBeNull();
      expect(statuses).not.toBeNull();
      expect(categories).not.toBeNull();
      expect(autoArchive?.textContent).toContain(
        "Projects in Collections won't be auto-archived.",
      );
    } finally {
      close();
    }
  });
});
