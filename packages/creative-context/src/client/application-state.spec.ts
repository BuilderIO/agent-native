// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBrowserTabId: vi.fn(() => "tab-1"),
  readClientAppState: vi.fn().mockResolvedValue(null),
  setClientAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/client/hooks", async () => ({
  ...mocks,
  useChangeVersions: (
    await import("../../../core/src/client/use-change-version.js")
  ).useChangeVersions,
  useChangeVersion: (
    await import("../../../core/src/client/use-change-version.js")
  ).useChangeVersion,
}));

import {
  _resetChangeVersionStoreForTests,
  bumpChangeVersion,
} from "../../../core/src/client/use-change-version.js";
import {
  normalizeCreativeContextState,
  useCreativeContextState,
} from "./application-state.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  _resetChangeVersionStoreForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("normalizeCreativeContextState", () => {
  it("defaults missing state to automatic context", () => {
    expect(normalizeCreativeContextState(null)).toEqual({
      contextMode: "auto",
      selectedContextId: null,
      currentPackId: null,
      pinnedPackId: null,
    });
  });

  it("clears current and pinned packs when context is off", () => {
    expect(
      normalizeCreativeContextState({
        contextMode: "off",
        selectedContextId: "selected-context",
        currentPackId: "current-pack",
        pinnedPackId: "pinned-pack",
      }),
    ).toEqual({
      contextMode: "off",
      selectedContextId: null,
      currentPackId: null,
      pinnedPackId: null,
    });
  });

  it("keeps valid pack ids in automatic mode", () => {
    expect(
      normalizeCreativeContextState({
        contextMode: "auto",
        selectedContextId: " selected-context ",
        currentPackId: " current-pack ",
        pinnedPackId: "pinned-pack",
      }),
    ).toEqual({
      contextMode: "auto",
      selectedContextId: "selected-context",
      currentPackId: "current-pack",
      pinnedPackId: "pinned-pack",
    });
  });
});

describe("useCreativeContextState", () => {
  it("does not read saved state while disabled", async () => {
    function Probe() {
      const context = useCreativeContextState({ enabled: false });
      return createElement("output", {
        "data-loading": String(context.isLoading),
      });
    }

    await act(async () => {
      root.render(createElement(Probe));
    });

    expect(mocks.readClientAppState).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.dataset.loading).toBe("false");
  });

  it("ignores unrelated app state changes while disabled", async () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      useCreativeContextState({ enabled: false });
      return createElement("output");
    }

    await act(async () => root.render(createElement(Probe)));
    const settledRenders = renders;
    await act(async () => {
      bumpChangeVersion("app-state", 1);
      bumpChangeVersion("app-state:native-render-contexts-v1", 1);
      bumpChangeVersion("app-state:creative-context", 1);
      bumpChangeVersion("app-state:*", 1);
    });

    expect(renders).toBe(settledRenders);
    expect(mocks.readClientAppState).not.toHaveBeenCalled();
  });

  it("refreshes only for creative context or keyless app state changes", async () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      useCreativeContextState();
      return createElement("output");
    }

    await act(async () => root.render(createElement(Probe)));
    expect(mocks.readClientAppState).toHaveBeenCalledTimes(1);
    const settledRenders = renders;
    await act(async () => {
      bumpChangeVersion("app-state", 1);
      bumpChangeVersion("app-state:native-render-contexts-v1", 1);
    });
    expect(renders).toBe(settledRenders);
    expect(mocks.readClientAppState).toHaveBeenCalledTimes(1);

    await act(async () => bumpChangeVersion("app-state:creative-context", 1));
    expect(mocks.readClientAppState).toHaveBeenCalledTimes(2);
    await act(async () => bumpChangeVersion("app-state:*", 1));
    expect(mocks.readClientAppState).toHaveBeenCalledTimes(3);
  });
});
