// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectRoute from "./connect";

const connectState = vi.hoisted(() => ({
  enabled: false,
  status: "ready" as "loading" | "ready",
  useActionQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useActionMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({
    enabled: connectState.enabled,
    status: connectState.status,
  }),
}));
vi.mock("../../components/dispatch-shell", () => ({
  DispatchShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: connectState.useActionQuery,
  useActionMutation: connectState.useActionMutation,
}));

describe("ConnectRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    connectState.enabled = false;
    connectState.status = "ready";
    connectState.useActionQuery.mockClear();
    connectState.useActionMutation.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing and does not fetch when the labs flag is off", async () => {
    await act(async () => root.render(<ConnectRoute />));
    expect(container.innerHTML).toBe("");
    expect(connectState.useActionQuery).not.toHaveBeenCalled();
    expect(connectState.useActionMutation).not.toHaveBeenCalled();
  });

  it("shows the page skeleton while the labs flag is loading", async () => {
    connectState.status = "loading";
    await act(async () => root.render(<ConnectRoute />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(connectState.useActionQuery).not.toHaveBeenCalled();
    expect(connectState.useActionMutation).not.toHaveBeenCalled();
  });

  it("inspects a URL through the server action and renders its card", async () => {
    connectState.enabled = true;
    const mutateAsync = vi.fn().mockResolvedValue({
      name: "Slides",
      description: "A slide workspace",
      url: "https://slides.example.com/_agent-native/a2a",
      connect: true,
    });
    connectState.useActionMutation.mockReturnValue({ mutateAsync } as never);

    await act(async () => root.render(<ConnectRoute />));
    expect(connectState.useActionQuery).toHaveBeenCalledWith(
      "list-connect-marketplace-apps",
      {},
      { staleTime: 5 * 60 * 1000, retry: 1 },
    );

    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "https://slides.example.com");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const inspectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("dispatch.pages.inspectApp"),
    );
    expect(inspectButton).toBeDefined();
    await act(async () => inspectButton?.click());

    expect(mutateAsync).toHaveBeenCalledWith({
      url: "https://slides.example.com/",
    });
    expect(container.querySelector("[data-connect-card] h3")?.textContent).toBe(
      "Slides",
    );
  });
});
