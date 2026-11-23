// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  categoriesPending: false,
  categoriesError: false,
  categoriesData: undefined as
    | {
        categories: { id: string; name: string; color: string | null }[];
        assignments: { projectId: string; categoryIds: string[] }[];
      }
    | undefined,
  isAdmin: true,
  refetch: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: state.callAction,
  useActionQuery: (name: string) => {
    if (name === "get-workspace-bootstrap") {
      return {
        data: { features: { isAdmin: state.isAdmin } },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
    }
    return {
      data: state.categoriesData,
      isPending: state.categoriesPending,
      isError: state.categoriesError,
      refetch: state.refetch,
    };
  },
}));

import { ProjectCategoriesDialog } from "./ProjectCategoriesDialog";

const project = {
  id: "prj_1",
  ownerEmail: "qa@example.test",
  title: "Revenue",
  description: "",
  language: "python" as const,
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
};

describe("ProjectCategoriesDialog network failure and in-flight races", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    state.categoriesPending = false;
    state.categoriesError = false;
    state.categoriesData = undefined;
    state.isAdmin = true;
    state.refetch.mockReset();
    state.callAction.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderDialog(onClose = vi.fn()) {
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ProjectCategoriesDialog project={project} onClose={onClose} />
        </QueryClientProvider>,
      );
    });
    return onClose;
  }

  it("blocks Save, hides the empty-catalogue note, and offers Retry on load error", () => {
    state.categoriesError = true;
    renderDialog();

    const save = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save",
    ) as HTMLButtonElement | undefined;
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    ) as HTMLButtonElement | undefined;

    expect(save?.disabled).toBe(true);
    expect(host.textContent).toContain("Categories could not be loaded.");
    expect(host.textContent).not.toContain(
      "This workspace has no categories yet.",
    );
    expect(retry).toBeDefined();

    act(() => retry?.click());
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.callAction).not.toHaveBeenCalled();
  });

  it("disables admin category creation while existing categories are still loading", () => {
    state.categoriesPending = true;
    renderDialog();

    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="Category name"]',
    );
    const add = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add",
    ) as HTMLButtonElement | undefined;

    expect(input?.disabled).toBe(true);
    expect(add?.disabled).toBe(true);
  });

  it("blocks Cancel and Escape while saving and hides internal action names on failure", async () => {
    state.categoriesData = {
      categories: [{ id: "cat_1", name: "Finance", color: "#2563eb" }],
      assignments: [{ projectId: "prj_1", categoryIds: ["cat_1"] }],
    };
    let rejectSave!: (reason: Error) => void;
    state.callAction.mockReturnValue(
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
    );
    const onClose = renderDialog();

    const save = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save",
    ) as HTMLButtonElement;
    const cancel = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel",
    ) as HTMLButtonElement;

    act(() => save.click());
    expect(cancel.disabled).toBe(true);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      rejectSave(
        new Error(
          "Action update-project-categories failed: Service unavailable",
        ),
      );
    });
    expect(host.textContent).not.toContain("Action update-project-categories");
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
