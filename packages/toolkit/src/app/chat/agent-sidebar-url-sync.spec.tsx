// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  setClientAppState: vi.fn(async (_key: string, value: unknown) => value),
  readClientAppState: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/client/application-state", () => appState);

import {
  _resetSettingsReturnPathForTests,
  readSettingsReturnPath,
} from "../settings/shell/return-path.js";
import {
  SettingsReturnPathRecorder,
  URLSync,
} from "./agent-sidebar-url-sync.js";

describe("SettingsReturnPathRecorder", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    _resetSettingsReturnPathForTests();
    window.sessionStorage.clear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("remembers the app route without the agent panel mounted", () => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/library?folder=recent"]}>
          <SettingsReturnPathRecorder />
        </MemoryRouter>,
      ),
    );
    expect(readSettingsReturnPath()).toBe("/library?folder=recent");
  });

  it("renders nothing outside a router", () => {
    expect(() =>
      act(() => root.render(<SettingsReturnPathRecorder />)),
    ).not.toThrow();
    expect(readSettingsReturnPath()).toBeNull();
  });
});

describe("URLSync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("null")),
    );
    appState.setClientAppState.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("writes the tab's URL through the tracked client writer so sends can wait for it", () => {
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/decks/d1?slide=2"]}>
            <URLSync browserTabId="tab-1" />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );

    expect(appState.setClientAppState).toHaveBeenCalledWith(
      "__url__:tab-1",
      expect.objectContaining({
        pathname: "/decks/d1",
        search: "?slide=2",
        searchParams: { slide: "2" },
      }),
      { keepalive: true },
    );
  });
});
