// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  BuilderReviewOpeningPanel,
  type BuilderReviewOpeningPanelHandle,
} from "./BuilderReviewOpeningPanel";

const panel = () => document.querySelector("[data-builder-review-opening]");

describe("BuilderReviewOpeningPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const handle = createRef<BuilderReviewOpeningPanelHandle>();

  function render(dialogOpen: boolean) {
    act(() => {
      root.render(
        <BuilderReviewOpeningPanel ref={handle} dialogOpen={dialogOpen} />,
      );
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    render(false);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stays under the dialog until the dialog has faded in", () => {
    expect(panel()).toBeNull();
    act(() => handle.current?.show());
    expect(panel()?.textContent).toContain("database.reviewBuilderUpdate");
    expect(panel()?.textContent).toContain(
      "database.loadingCompleteBuilderDiff",
    );

    render(true);
    expect(panel()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(panel()).toBeNull();
  });

  it("goes away with a dialog that closes before it has faded in", () => {
    act(() => handle.current?.show());
    render(true);
    render(false);
    expect(panel()).toBeNull();
  });

  it("goes away when the review closes before its dialog opened", () => {
    act(() => handle.current?.show());
    act(() => handle.current?.hide());
    expect(panel()).toBeNull();
  });
});
