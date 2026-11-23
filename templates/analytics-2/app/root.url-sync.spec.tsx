// @vitest-environment happy-dom
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  commands: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
}));

vi.mock("./lib/tab-id", () => ({ TAB_ID: "tab-1" }));
vi.mock("@agent-native/core/client/application-state", async (original) => ({
  ...(await original<object>()),
  readClientAppState: vi.fn(async (key: string) => {
    state.reads.push(key);
    return state.commands.get(key) ?? null;
  }),
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<object>()),
  useDbSync: () => {},
}));
vi.mock("@agent-native/toolkit/app/providers", () => ({
  AppProviders: ({
    children,
    queryClient,
  }: {
    children: ReactNode;
    queryClient: QueryClient;
  }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  ),
}));
vi.mock("./components/ui/toolkit-provider", () => ({
  AppToolkitProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/workspace/WorkspaceApplication", () => ({
  WorkspaceApplication: () => null,
}));
vi.mock("./hooks/use-navigation-state", () => ({
  useNavigationState: () => {},
}));

import Root from "./root";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
notifyManager.setScheduler((callback) => callback());

let reactRoot: ReactRoot;
let container: HTMLDivElement;
let pathname = "";

function LocationProbe() {
  pathname = useLocation().pathname;
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.commands.clear();
  state.reads.length = 0;
  pathname = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("report idea-1ab51e: applies framework __set_url__ commands from a docked notebook route", async () => {
  state.commands.set("__set_url__:tab-1", {
    pathname: "/settings/model",
    searchParams: {},
    mergeSearchParams: false,
    hash: "",
    _writeId: "oracle-1",
  });
  await act(async () => {
    reactRoot.render(
      <MemoryRouter initialEntries={["/project/proj-1/latest"]}>
        <Root />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await vi.waitFor(() => expect(pathname).toBe("/settings/model"), {
    timeout: 2000,
  });
  expect(state.reads).toContain("__set_url__:tab-1");
});
