// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: undefined as
    | { progressPercent: number; completedSteps: readonly string[] }
    | undefined,
  isPending: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.data,
    isPending: mocks.isPending,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
}));

import { ContextSetupView } from "./ContextSetupView";

describe("ContextSetupView loading and error states", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.data = undefined;
    mocks.isPending = false;
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.refetch.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (initialEntry = "/context-studio/setup") =>
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <ContextSetupView />
        </MemoryRouter>,
      );
    });

  it("shows an error alert with retry instead of 0 of 6 complete when setup fails", async () => {
    mocks.isError = true;
    render();
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(host.textContent).not.toContain("0 of 6 complete");
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "error.retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("shows a loading status instead of 0 of 6 complete while setup is pending", () => {
    mocks.isPending = true;
    render();
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).not.toContain("0 of 6 complete");
    expect(host.textContent).not.toContain("Not started");
  });

  it("scrolls the targeted setup section into view when opened with a step hash", () => {
    mocks.data = { progressPercent: 0, completedSteps: [] };
    const scrollIntoView = vi.fn();
    const origGetById = document.getElementById.bind(document);
    const spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation((id) => {
        const element = origGetById(id);
        if (element && id === "context-setup-endorse") {
          element.scrollIntoView = scrollIntoView;
        }
        return element;
      });
    try {
      render("/context-studio/setup#context-setup-endorse");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    } finally {
      spy.mockRestore();
    }
  });
});
