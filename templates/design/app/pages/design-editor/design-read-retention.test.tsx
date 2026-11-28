// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESIGN_READ_RETRY_DELAYS_MS,
  resolveDesignRead,
  startDesignReadRecovery,
  useRetainedDesignRead,
  type DesignReadState,
} from "./design-read-retention";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Metadata = { id: string; files: { id: string }[] };
const design: Metadata = { id: "design-1", files: [{ id: "screen" }] };
const unsettled = { status: undefined, settled: false };

describe("resolveDesignRead", () => {
  it("passes a first read through untouched when nothing is open yet", () => {
    expect(
      resolveDesignRead<Metadata>({
        read: undefined,
        retained: null,
        access: {
          status: { hasAccess: false, signedIn: true },
          settled: true,
        },
        viewerSignedIn: true,
      }),
    ).toEqual({ state: "absent", metadata: undefined });
  });

  it.each([
    ["a refused or failed read", undefined],
    ["a payload that is not a design", "<!doctype html>"],
  ])("keeps the open design through %s", (_label, read) => {
    expect(
      resolveDesignRead({
        read,
        retained: design,
        access: unsettled,
        viewerSignedIn: true,
      }),
    ).toEqual({ state: "retained", metadata: design });
  });

  it("keeps the open design when the access check still grants it", () => {
    expect(
      resolveDesignRead({
        read: undefined,
        retained: design,
        access: { status: { hasAccess: true, signedIn: true }, settled: true },
        viewerSignedIn: true,
      }).state,
    ).toBe("retained");
  });

  it("closes the design once the access check refuses the viewer", () => {
    expect(
      resolveDesignRead({
        read: undefined,
        retained: design,
        access: {
          status: { hasAccess: false, signedIn: true },
          settled: true,
        },
        viewerSignedIn: true,
      }),
    ).toEqual({ state: "lost", metadata: undefined });
  });

  it.each([
    ["is still signed in", true, "retained"],
    ["is still being read", undefined, "retained"],
    ["is signed out", false, "lost"],
  ] as const)(
    "treats a signed-out access answer by whether the session %s",
    (_label, viewerSignedIn, state) => {
      expect(
        resolveDesignRead({
          read: undefined,
          retained: design,
          access: {
            status: { hasAccess: false, signedIn: false },
            settled: true,
          },
          viewerSignedIn,
        }).state,
      ).toBe(state);
    },
  );
});

describe("startDesignReadRecovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function recovery(visibilityState: "visible" | "hidden" = "visible") {
    const retryRead = vi.fn();
    const checkAccess = vi.fn();
    const doc = Object.assign(new EventTarget(), { visibilityState });
    const win = new EventTarget();
    const stop = startDesignReadRecovery({
      retryRead,
      checkAccess,
      doc: doc as unknown as Document,
      win: win as unknown as Window,
    });
    return { retryRead, checkAccess, doc, win, stop };
  }

  it("asks for a new access answer at once and re-reads with backoff", () => {
    const { retryRead, checkAccess, stop } = recovery();
    expect(checkAccess).toHaveBeenCalledTimes(1);
    expect(retryRead).not.toHaveBeenCalled();

    DESIGN_READ_RETRY_DELAYS_MS.forEach((delay, index) => {
      vi.advanceTimersByTime(delay - 1);
      expect(retryRead).toHaveBeenCalledTimes(index);
      vi.advanceTimersByTime(1);
      expect(retryRead).toHaveBeenCalledTimes(index + 1);
    });
    vi.advanceTimersByTime(Math.max(...DESIGN_READ_RETRY_DELAYS_MS));
    expect(retryRead).toHaveBeenCalledTimes(
      DESIGN_READ_RETRY_DELAYS_MS.length + 1,
    );

    stop();
    vi.advanceTimersByTime(60_000);
    expect(retryRead).toHaveBeenCalledTimes(
      DESIGN_READ_RETRY_DELAYS_MS.length + 1,
    );
  });

  it("waits while the tab is hidden and re-reads the moment it is shown", () => {
    const { retryRead, doc, stop } = recovery("hidden");
    vi.advanceTimersByTime(60_000);
    expect(retryRead).not.toHaveBeenCalled();

    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(retryRead).toHaveBeenCalledTimes(1);
    stop();
  });

  it("re-reads when the network returns", () => {
    const { retryRead, win, stop } = recovery();
    win.dispatchEvent(new Event("online"));
    expect(retryRead).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("useRetainedDesignRead", () => {
  let container: HTMLDivElement;
  let root: Root;
  const retryRead = vi.fn();
  const checkAccess = vi.fn();
  let latest: { state: DesignReadState; metadata: unknown };

  type Props = {
    read: Metadata | string | undefined;
    accessStatus?: { hasAccess: boolean; signedIn: boolean };
    accessCheckedAt?: number;
    accessCheckPending?: boolean;
    accessCheckFailed?: boolean;
    viewerSignedIn?: boolean;
  };
  function Probe(props: Props) {
    latest = useRetainedDesignRead<Metadata>({
      id: "design-1",
      read: props.read,
      accessStatus: props.accessStatus,
      accessCheckedAt: props.accessCheckedAt ?? 0,
      accessCheckPending: props.accessCheckPending ?? false,
      accessCheckFailed: props.accessCheckFailed ?? false,
      viewerSignedIn: props.viewerSignedIn ?? true,
      retryRead,
      checkAccess,
    });
    return null;
  }
  const render = (props: Props) =>
    act(async () => root.render(<Probe {...props} />));

  beforeEach(() => {
    vi.useFakeTimers();
    retryRead.mockClear();
    checkAccess.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps a loaded design mounted through a transient refetch failure and recovers", async () => {
    await render({ read: design, accessCheckedAt: 5 });
    expect(latest).toEqual({ state: "live", metadata: design });

    await render({
      read: undefined,
      accessCheckedAt: 5,
      accessCheckPending: true,
    });
    expect(latest.state).toBe("retained");
    expect(latest.metadata).toBe(design);
    expect(checkAccess).toHaveBeenCalledTimes(1);

    await render({
      read: undefined,
      accessStatus: { hasAccess: false, signedIn: true },
      accessCheckedAt: 5,
    });
    expect(latest.metadata).toBe(design);

    await render({
      read: undefined,
      accessCheckedAt: 5,
      accessCheckFailed: true,
    });
    expect(latest.metadata).toBe(design);
    await render({
      read: "Bad Gateway",
      accessStatus: { hasAccess: true, signedIn: true },
      accessCheckedAt: 9,
    });
    expect(latest.state).toBe("retained");
    expect(latest.metadata).toBe(design);

    await act(async () => {
      vi.advanceTimersByTime(DESIGN_READ_RETRY_DELAYS_MS[0]);
    });
    expect(retryRead).toHaveBeenCalledTimes(1);

    const refreshed: Metadata = { id: "design-1", files: [{ id: "screen" }] };
    await render({ read: refreshed, accessCheckedAt: 9 });
    expect(latest).toEqual({ state: "live", metadata: refreshed });
    expect(latest.metadata).toBe(refreshed);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(retryRead).toHaveBeenCalledTimes(1);
  });

  it("closes the design when access is really gone, and keeps it closed", async () => {
    await render({ read: design, accessCheckedAt: 5 });
    await render({
      read: undefined,
      accessStatus: { hasAccess: false, signedIn: true },
      accessCheckedAt: 12,
    });
    expect(latest).toEqual({ state: "lost", metadata: undefined });

    await render({
      read: undefined,
      accessCheckedAt: 12,
      accessCheckPending: true,
    });
    expect(latest).toEqual({ state: "lost", metadata: undefined });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(retryRead).not.toHaveBeenCalled();
  });
});
