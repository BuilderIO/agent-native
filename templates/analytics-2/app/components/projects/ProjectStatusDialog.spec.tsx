// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  data: undefined as { statuses: { id: string; name: string }[] } | undefined,
  refetch: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callAction: state.callAction,
  useActionQuery: () => ({
    data: state.data,
    isPending: state.isPending,
    isError: state.isError,
    refetch: state.refetch,
  }),
}));

import { ProjectStatusDialog } from "./ProjectStatusDialog";

const project = {
  id: "prj_1",
  ownerEmail: "qa@example.test",
  title: "Revenue",
  description: "",
  language: "python" as const,
  statusId: "st_verified",
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
};

describe("ProjectStatusDialog network failure and in-flight races", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    state.isPending = false;
    state.isError = false;
    state.data = undefined;
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
          <ProjectStatusDialog project={project} onClose={onClose} />
        </QueryClientProvider>,
      );
    });
    return onClose;
  }

  it("disables select and Save and offers Retry when statuses fail to load", () => {
    state.isError = true;
    renderDialog();

    const select = host.querySelector<HTMLSelectElement>("select");
    const save = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save",
    ) as HTMLButtonElement | undefined;
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    ) as HTMLButtonElement | undefined;

    expect(select?.disabled).toBe(true);
    expect(save?.disabled).toBe(true);
    expect(host.textContent).toContain("Statuses could not be loaded.");
    expect(retry).toBeDefined();

    act(() => retry?.click());
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.callAction).not.toHaveBeenCalled();
  });

  it("blocks Cancel and Escape during an in-flight save and hides raw action error text", async () => {
    state.data = { statuses: [{ id: "st_verified", name: "Verified" }] };
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
      rejectSave(new Error("Action update-project failed: 503"));
    });
    expect(host.textContent).not.toContain("Action update-project");
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
