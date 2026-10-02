// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectRoute from "./connect";

const connectState = vi.hoisted(() => ({
  enabled: false,
  status: "ready" as "loading" | "ready",
  useQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
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
vi.mock("@tanstack/react-query", () => ({
  useQuery: connectState.useQuery,
}));

describe("ConnectRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    connectState.enabled = false;
    connectState.status = "ready";
    connectState.useQuery.mockClear();
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
    expect(connectState.useQuery).not.toHaveBeenCalled();
  });

  it("shows the page skeleton while the labs flag is loading", async () => {
    connectState.status = "loading";
    await act(async () => root.render(<ConnectRoute />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(connectState.useQuery).not.toHaveBeenCalled();
  });
});
