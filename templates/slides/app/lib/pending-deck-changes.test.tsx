// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  shouldBlockPendingDeckNavigation,
  usePendingDeckUnloadGuard,
} from "./pending-deck-changes";

function GuardHarness({ pending }: { pending: boolean }) {
  usePendingDeckUnloadGuard(pending);
  return null;
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe("pending deck changes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("blocks a hard reload only while pending edits exist", async () => {
    await act(async () => root.render(<GuardHarness pending={false} />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    await act(async () => root.render(<GuardHarness pending />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("removes the reload guard after the pending state clears", async () => {
    await act(async () => root.render(<GuardHarness pending />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await act(async () => root.render(<GuardHarness pending={false} />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("blocks leaving the editor but not in-place slide navigation", () => {
    expect(
      shouldBlockPendingDeckNavigation({
        hasPendingEdits: true,
        currentPathname: "/deck/one",
        nextPathname: "/",
      }),
    ).toBe(true);
    expect(
      shouldBlockPendingDeckNavigation({
        hasPendingEdits: true,
        currentPathname: "/deck/one",
        nextPathname: "/deck/one",
      }),
    ).toBe(false);
    expect(
      shouldBlockPendingDeckNavigation({
        hasPendingEdits: false,
        currentPathname: "/deck/one",
        nextPathname: "/",
      }),
    ).toBe(false);
  });
});
