// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({ ok: true })),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-content-action-mutation", () => ({
  useContentActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: mocks.toastError, success: vi.fn() },
}));

import { AgentTextLockSetting } from "./AgentTextLockSetting";

describe("AgentTextLockSetting", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutateAsync.mockClear();
    mocks.mutateAsync.mockImplementation(async () => ({ ok: true }));
    mocks.toastError.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(props: { locked: boolean; canManage: boolean }) {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(AgentTextLockSetting, {
            documentId: "page-1",
            ...props,
          }),
        ),
      );
    });
    return container.querySelector('[role="switch"]') as HTMLButtonElement;
  }

  it("names the setting and its limits", async () => {
    await show({ locked: false, canManage: true });
    expect(container.textContent).toContain("editor.toolbar.agentTextLock");
    expect(container.textContent).toContain(
      "editor.toolbar.agentTextLockDescription",
    );
  });

  it("turns the lock on for someone who manages the page", async () => {
    const control = await show({ locked: false, canManage: true });
    expect(control.getAttribute("aria-checked")).toBe("false");
    await act(async () => control.click());
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      id: "page-1",
      locked: true,
    });
  });

  it("turns the lock off again", async () => {
    const control = await show({ locked: true, canManage: true });
    expect(control.getAttribute("aria-checked")).toBe("true");
    await act(async () => control.click());
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      id: "page-1",
      locked: false,
    });
  });

  it("shows the state but won't change it without manage access", async () => {
    const control = await show({ locked: true, canManage: false });
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.disabled).toBe(true);
    await act(async () => control.click());
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("says so and goes back when the save fails", async () => {
    mocks.mutateAsync.mockImplementation(async () => {
      throw new Error("No access");
    });
    const control = await show({ locked: false, canManage: true });
    await act(async () => control.click());
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.disabled).toBe(false);
  });
});
