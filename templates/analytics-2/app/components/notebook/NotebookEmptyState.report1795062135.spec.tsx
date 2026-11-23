// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@agent-native/core/client/i18n",
  async () => (await import("@/skins/reference/testing/i18n")).i18nMock,
);

// One in-memory workspace behind the two list actions and the two writes, so
// a selection made in the mounted UI is what the next mount reads back.
const db = vi.hoisted(() => ({
  statuses: [] as Array<{
    id: string;
    name: string;
    description: string;
    color: string | null;
    endorsed: boolean;
    inLibrary: boolean;
    enforcesReview: boolean;
    sortOrder: number;
  }>,
  categories: [] as Array<{
    id: string;
    name: string;
    color: string | null;
    description?: string;
  }>,
  statusId: null as string | null,
  categoryIds: [] as string[],
  categoryReadProjectId: undefined as string | undefined,
  // When set, the category list read keeps returning this stale assignment.
  staleCategoryIds: null as string[] | null,
  isAdmin: false,
  isManagerOrAbove: true,
  calls: [] as Array<{ name: string; input: unknown }>,
  failNext: false,
  // While true, writes wait here until the test settles them.
  defer: false,
  pending: [] as Array<{
    name: string;
    input: Record<string, unknown>;
    resolve: () => void;
    reject: (cause: Error) => void;
  }>,
}));

function commit(name: string, input: Record<string, unknown>) {
  if (name === "update-project") db.statusId = input.statusId as string | null;
  if (name === "update-project-categories")
    db.categoryIds = input.categoryIds as string[];
}

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (cause: unknown) =>
    cause instanceof Error ? cause.message : null,
  useActionQuery: (name: string, input?: { projectId?: string }) => {
    if (name === "list-data-statuses")
      return {
        data: { statuses: db.statuses, defaultStatusId: null },
        isPending: false,
        isError: false,
      };
    if (name === "list-project-categories") {
      db.categoryReadProjectId = input?.projectId;
      return {
        data: {
          categories: db.categories,
          assignments: [
            {
              projectId: "prj_1",
              categoryIds: db.staleCategoryIds ?? db.categoryIds,
            },
          ],
        },
        isPending: false,
        isError: false,
      };
    }
    if (name === "get-workspace-shell")
      return {
        data: {
          features: {
            isAdmin: db.isAdmin,
            isManagerOrAbove: db.isManagerOrAbove,
          },
        },
        isPending: false,
        isError: false,
      };
    throw new Error(`unexpected query ${name}`);
  },
  useActionMutation: (name: string) => ({
    mutateAsync: async (input: Record<string, unknown>) => {
      db.calls.push({ name, input });
      if (db.defer)
        return new Promise<object>((resolve, reject) => {
          db.pending.push({
            name,
            input,
            resolve: () => {
              commit(name, input);
              resolve({});
            },
            reject,
          });
        });
      if (db.failNext) {
        db.failNext = false;
        throw new Error("The write was refused.");
      }
      commit(name, input);
      return {};
    },
  }),
}));

import { ProjectMetaPickers } from "./ProjectMetaPickers";

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
let queryClient: QueryClient;

beforeEach(() => {
  Object.assign(db, {
    statuses: [
      status("sts_progress", "In development", false),
      status("sts_done", "Completed", false),
      status("sts_endorsed", "Endorsed", true),
    ],
    categories: [
      {
        id: "cat_finance",
        name: "Finance",
        color: "#2563eb",
        description: "Company financials",
      },
      { id: "cat_growth", name: "Growth", color: null },
    ],
    statusId: null,
    categoryIds: [],
    categoryReadProjectId: undefined,
    staleCategoryIds: null,
    isAdmin: false,
    isManagerOrAbove: true,
    calls: [],
    failNext: false,
    defer: false,
    pending: [],
  });
  // Radix menus measure and observe their trigger.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function status(id: string, name: string, endorsed: boolean) {
  return {
    id,
    name,
    description: "",
    color: null,
    endorsed,
    inLibrary: false,
    enforcesReview: false,
    sortOrder: 0,
  };
}

function element(props: { canEdit?: boolean; statusId?: string | null } = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectMetaPickers
        projectId="prj_1"
        statusId={props.statusId === undefined ? db.statusId : props.statusId}
        canEdit={props.canEdit ?? true}
      />
    </QueryClientProvider>
  );
}

function mount(props: { canEdit?: boolean } = {}) {
  queryClient = new QueryClient();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element(props)));
}
/** The project read reports `statusId`, whatever the writes have accepted. */
function readReports(statusId: string | null) {
  act(() => root?.render(element({ statusId })));
}
function unmount() {
  act(() => root?.unmount());
  host.remove();
}
function metaButton(label: RegExp) {
  const found = [
    ...host.querySelectorAll<HTMLButtonElement>(".nb-empty-meta button"),
  ].find((button) => label.test(button.textContent));
  if (found == null) throw new Error(`no metadata button ${label}`);
  return found;
}
function open(button: HTMLButtonElement) {
  // Radix opens its menu on pointerdown, not click.
  act(() => {
    button.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
}
function menuItems() {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]',
    ),
  ];
}
function item(name: RegExp) {
  const found = menuItems().find((entry) => name.test(entry.textContent));
  if (found == null) throw new Error(`no menu item ${name}`);
  return found;
}
async function choose(entry: HTMLElement) {
  await act(async () => {
    entry.click();
    await Promise.resolve();
  });
}

describe("notebook status and categories", () => {
  it("opens the workspace statuses from Add status, with endorsed ones in their own section", () => {
    mount();
    const trigger = metaButton(/Add status/);
    expect(trigger.disabled).toBe(false);
    open(trigger);
    expect(menuItems().map((entry) => entry.textContent.trim())).toEqual([
      "In development",
      "Completed",
      "Endorsed",
    ]);
    expect(document.body.textContent).toContain("Endorsed Statuses");
    expect(document.body.textContent).not.toContain("Clear status");
  });

  it("applies a status, shows it on the button, and reads it back after a reload", async () => {
    mount();
    open(metaButton(/Add status/));
    await choose(item(/Completed/));
    expect(db.calls).toEqual([
      {
        name: "update-project",
        input: { projectId: "prj_1", statusId: "sts_done" },
      },
    ]);
    expect(metaButton(/Completed/).textContent).toContain("Completed");

    unmount();
    mount();
    expect(metaButton(/Completed/).textContent).toContain("Completed");
    open(metaButton(/Completed/));
    expect(item(/Completed/).getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("Clear status");
  });

  it("clears an applied status", async () => {
    db.statusId = "sts_done";
    mount();
    open(metaButton(/Completed/));
    await choose(item(/Clear status/));
    expect(db.calls.at(-1)).toEqual({
      name: "update-project",
      input: { projectId: "prj_1", statusId: null },
    });
    expect(metaButton(/Add status/)).toBeTruthy();
  });

  it("keeps endorsed statuses unavailable below manager", () => {
    db.isManagerOrAbove = false;
    mount();
    open(metaButton(/Add status/));
    expect(item(/Endorsed$/).getAttribute("aria-disabled")).toBe("true");
    expect(item(/Completed/).getAttribute("aria-disabled")).toBeNull();
  });

  it("restores the previous status and says so when the write fails", async () => {
    db.statusId = "sts_done";
    db.failNext = true;
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    expect(metaButton(/Completed/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "The write was refused.",
    );
  });

  it("lists workspace categories as checkboxes and persists toggles across a reload", async () => {
    mount();
    const trigger = metaButton(/Add categories/);
    expect(trigger.disabled).toBe(false);
    open(trigger);
    expect(menuItems().map((entry) => entry.textContent.trim())).toEqual([
      "Finance",
      "Growth",
    ]);
    expect(item(/Finance/).title).toBe("Company financials");
    await choose(item(/Finance/));
    expect(db.calls.at(-1)).toEqual({
      name: "update-project-categories",
      input: { projectId: "prj_1", categoryIds: ["cat_finance"] },
    });
    // A checkbox toggle keeps the menu open for the next pick.
    await choose(item(/Growth/));
    expect(db.calls.at(-1)?.input).toEqual({
      projectId: "prj_1",
      categoryIds: ["cat_finance", "cat_growth"],
    });
    expect(item(/Finance/).getAttribute("aria-checked")).toBe("true");

    unmount();
    mount();
    expect(metaButton(/Finance/).textContent).toContain("Finance");
    open(metaButton(/Finance/));
    await choose(item(/Finance/));
    expect(db.calls.at(-1)?.input).toEqual({
      projectId: "prj_1",
      categoryIds: ["cat_growth"],
    });
  });

  it("does not invent categories for a workspace that has none", () => {
    db.categories = [];
    mount();
    open(metaButton(/Add categories/));
    expect(menuItems()).toEqual([]);
    expect(document.body.textContent).toContain("No categories");
  });

  it("offers no editable pickers to a viewer with nothing applied", () => {
    mount({ canEdit: false });
    expect(host.querySelector(".nb-empty-meta button")).toBeNull();
  });

  it("shows assigned metadata from the scoped project read without offering viewer edits", () => {
    db.statusId = "sts_done";
    db.categoryIds = ["cat_finance"];
    mount({ canEdit: false });
    expect(db.categoryReadProjectId).toBe("prj_1");
    expect(host.textContent).toContain("Completed");
    expect(host.textContent).toContain("Finance");
    expect(host.querySelector(".nb-empty-meta button")).toBeNull();
  });

  it("writes only the latest status when a second pick lands before the first settles", async () => {
    db.defer = true;
    mount();
    open(metaButton(/Add status/));
    await choose(item(/Completed/));
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    expect(db.calls.map((call) => call.input)).toEqual([
      { projectId: "prj_1", statusId: "sts_done" },
    ]);
    expect(metaButton(/In development/)).toBeTruthy();

    await act(async () => db.pending[0]?.resolve());
    expect(db.calls.at(-1)?.input).toEqual({
      projectId: "prj_1",
      statusId: "sts_progress",
    });
    await act(async () => db.pending[1]?.resolve());
    expect(db.statusId).toBe("sts_progress");
    expect(metaButton(/In development/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the newer status when the older write fails", async () => {
    db.defer = true;
    mount();
    open(metaButton(/Add status/));
    await choose(item(/Completed/));
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    await act(async () => db.pending[0]?.reject(new Error("refused")));
    expect(metaButton(/In development/)).toBeTruthy();
    await act(async () => db.pending[1]?.resolve());
    expect(db.statusId).toBe("sts_progress");
    expect(metaButton(/In development/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("rolls back to the last accepted status when the newest write fails", async () => {
    db.statusId = "sts_done";
    db.defer = true;
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    await act(async () => db.pending[0]?.reject(new Error("refused")));
    expect(metaButton(/Completed/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "refused",
    );
  });

  it("writes the combined category set when a second toggle lands before the first settles", async () => {
    db.defer = true;
    mount();
    open(metaButton(/Add categories/));
    await choose(item(/Finance/));
    await choose(item(/Growth/));
    expect(db.calls).toHaveLength(1);
    expect(item(/Growth/).getAttribute("aria-checked")).toBe("true");

    await act(async () => db.pending[0]?.reject(new Error("refused")));
    expect(db.calls.at(-1)?.input).toEqual({
      projectId: "prj_1",
      categoryIds: ["cat_finance", "cat_growth"],
    });
    expect(item(/Finance/).getAttribute("aria-checked")).toBe("true");
    expect(item(/Growth/).getAttribute("aria-checked")).toBe("true");
    await act(async () => db.pending[1]?.resolve());
    expect(db.categoryIds).toEqual(["cat_finance", "cat_growth"]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps rapid category changes through a delayed, reordered read and reload", async () => {
    db.categories.push({ id: "cat_sales", name: "Sales", color: null });
    db.defer = true;
    mount();
    open(metaButton(/Add categories/));
    await choose(item(/Growth/));
    await choose(item(/Finance/));
    await act(async () => db.pending[0]?.resolve());
    await choose(item(/Sales/));
    await act(async () => db.pending[1]?.resolve());
    db.staleCategoryIds = [...db.categoryIds].sort();
    expect(db.staleCategoryIds).toEqual(["cat_finance", "cat_growth"]);
    expect(db.calls.at(-1)?.input).toEqual({
      projectId: "prj_1",
      categoryIds: ["cat_growth", "cat_finance", "cat_sales"],
    });

    await act(async () => db.pending[2]?.resolve());
    expect(item(/Sales/).getAttribute("aria-checked")).toBe("true");

    db.staleCategoryIds = [...db.categoryIds].sort();
    unmount();
    mount();
    expect(metaButton(/Finance, Growth, Sales/)).toBeTruthy();
  });

  it("rolls categories back to the last accepted set when the newest write fails", async () => {
    db.defer = true;
    mount();
    open(metaButton(/Add categories/));
    await choose(item(/Finance/));
    await choose(item(/Growth/));
    await act(async () => db.pending[0]?.resolve());
    await act(async () => db.pending[1]?.reject(new Error("refused")));
    expect(item(/Finance/).getAttribute("aria-checked")).toBe("true");
    expect(item(/Growth/).getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "refused",
    );
  });

  it("keeps the accepted status when a later write fails before the read catches up", async () => {
    db.statusId = "sts_done";
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    expect(db.statusId).toBe("sts_progress");
    // The mounted read still reports the status from before the accepted write.
    db.failNext = true;
    open(metaButton(/In development/));
    await choose(item(/Endorsed$/));
    expect(metaButton(/In development/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "refused",
    );
  });

  it("keeps the latest accepted status when a delayed read of an earlier one lands, then a later write fails", async () => {
    db.statuses.push(status("sts_hold", "On hold", false));
    db.statusId = "sts_done";
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    open(metaButton(/In development/));
    await choose(item(/Endorsed$/));
    expect(db.statusId).toBe("sts_endorsed");
    // The read that was in flight before the second write reports the first.
    readReports("sts_progress");
    expect(metaButton(/Endorsed/)).toBeTruthy();
    db.failNext = true;
    open(metaButton(/Endorsed/));
    await choose(item(/On hold/));
    expect(metaButton(/Endorsed/)).toBeTruthy();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "refused",
    );
  });

  it("follows a read that reports a status nobody here wrote", async () => {
    db.statuses.push(status("sts_hold", "On hold", false));
    db.statusId = "sts_done";
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    open(metaButton(/In development/));
    await choose(item(/Endorsed$/));
    readReports("sts_progress");
    readReports("sts_hold");
    expect(metaButton(/On hold/)).toBeTruthy();
    db.failNext = true;
    open(metaButton(/On hold/));
    await choose(item(/Endorsed$/));
    expect(metaButton(/On hold/)).toBeTruthy();
  });

  it("follows an outside change back to an earlier value once the read has caught up", async () => {
    db.statuses.push(status("sts_hold", "On hold", false));
    db.statusId = "sts_done";
    mount();
    open(metaButton(/Completed/));
    await choose(item(/In development/));
    readReports("sts_progress");
    readReports("sts_done");
    expect(metaButton(/Completed/)).toBeTruthy();
    db.failNext = true;
    open(metaButton(/Completed/));
    await choose(item(/On hold/));
    expect(metaButton(/Completed/)).toBeTruthy();
  });

  it("keeps the accepted categories when a later write fails before the read catches up", async () => {
    db.staleCategoryIds = [];
    mount();
    open(metaButton(/Add categories/));
    await choose(item(/Finance/));
    expect(db.categoryIds).toEqual(["cat_finance"]);
    db.failNext = true;
    await choose(item(/Growth/));
    expect(item(/Finance/).getAttribute("aria-checked")).toBe("true");
    expect(item(/Growth/).getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "refused",
    );
  });

  it("leaves focus in the New status dialog once the menu has closed", async () => {
    db.isAdmin = true;
    mount();
    open(metaButton(/Add status/));
    await choose(item(/New status/));
    // The closing menu returns focus to its trigger on a later task.
    await act(async () => {
      // fixed-sleep-ok: the menu returns focus to its trigger on a later task, which is the behavior under test
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
