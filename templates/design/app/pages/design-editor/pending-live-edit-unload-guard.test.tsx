// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePendingLiveEditUnloadGuard } from "./pending-live-edit-unload-guard";

function GuardHarness({ pending }: { pending: boolean }) {
  usePendingLiveEditUnloadGuard(pending);
  return null;
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", {
    cancelable: true,
  }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe("usePendingLiveEditUnloadGuard", () => {
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

  it("removes the reload guard after Apply or explicit discard clears pending state", async () => {
    await act(async () => root.render(<GuardHarness pending />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await act(async () => root.render(<GuardHarness pending={false} />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("removes the reload guard when the editor unmounts", async () => {
    await act(async () => root.render(<GuardHarness pending />));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});
