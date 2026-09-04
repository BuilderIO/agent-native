// @vitest-environment happy-dom

import React, { StrictMode, useEffect, useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReconnectReaderOwner } from "./use-reconnect-reader-owner.js";

type OwnerRecord = {
  controller: AbortController;
  mountedRef: { current: boolean };
};

function ReconnectOwnerHarness({
  id,
  onReady,
}: {
  id: string;
  onReady: (record: OwnerRecord) => void;
}) {
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useReconnectReaderOwner(runIdRef, abortRef);

  useEffect(() => {
    const controller = new AbortController();
    runIdRef.current = id;
    abortRef.current = controller;
    onReady({ controller, mountedRef });
  }, [id, mountedRef, onReady]);

  return null;
}

describe("useReconnectReaderOwner", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rootUnmounted: boolean;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    rootUnmounted = false;
  });

  afterEach(() => {
    if (!rootUnmounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("aborts the old reader across StrictMode remounts and blocks stale ownership", () => {
    const records: OwnerRecord[] = [];
    const onReady = (record: OwnerRecord) => records.push(record);

    act(() => {
      root.render(
        <StrictMode>
          <ReconnectOwnerHarness key="first" id="run-1" onReady={onReady} />
        </StrictMode>,
      );
    });

    const firstOwner = records.at(-1);
    expect(firstOwner?.controller.signal.aborted).toBe(false);
    expect(firstOwner?.mountedRef.current).toBe(true);

    act(() => {
      root.render(
        <StrictMode>
          <ReconnectOwnerHarness key="second" id="run-2" onReady={onReady} />
        </StrictMode>,
      );
    });

    const secondOwner = records.at(-1);
    expect(firstOwner?.controller.signal.aborted).toBe(true);
    expect(firstOwner?.mountedRef.current).toBe(false);
    expect(secondOwner?.controller.signal.aborted).toBe(false);
    expect(secondOwner?.mountedRef.current).toBe(true);

    act(() => root.unmount());
    rootUnmounted = true;
    expect(secondOwner?.controller.signal.aborted).toBe(true);
    expect(secondOwner?.mountedRef.current).toBe(false);
  });
});
