// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSettingsReturnPathForTests,
  readSettingsReturnPath,
} from "../settings/shell/return-path.js";
import { SettingsReturnPathRecorder } from "./agent-sidebar-url-sync.js";

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
