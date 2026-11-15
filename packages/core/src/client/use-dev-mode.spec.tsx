// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "./write-failure-event.js";

type Hooks = typeof import("./use-dev-mode.js");
type CodeMode = ReturnType<Hooks["useCodeMode"]>;
type DevMode = ReturnType<Hooks["useDevMode"]>;

const API_BASE = "/test-agent-chat";
const LOADED_MODE = { devMode: false, canToggle: true };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function isPost(init: RequestInit | undefined) {
  return init?.method === "POST";
}

describe("code mode toggle", () => {
  const fetchMock =
    vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const reports: WriteFailureDetail[] = [];
  const onReport = (event: Event) => {
    reports.push((event as CustomEvent<WriteFailureDetail>).detail);
  };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.addEventListener(WRITE_FAILURE_EVENT, onReport);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    window.removeEventListener(WRITE_FAILURE_EVENT, onReport);
    act(() => root.unmount());
    container.remove();
    reports.length = 0;
    vi.unstubAllGlobals();
  });

  // The loaded mode is cached at module level, so each test starts from a
  // fresh copy of the module.
  async function mount<T extends CodeMode | DevMode>(
    use: (hooks: Hooks) => () => T,
  ) {
    vi.resetModules();
    const hook = use(await import("./use-dev-mode.js"));
    let latest: T | undefined;
    function Probe() {
      latest = hook();
      return null;
    }
    await act(async () => root.render(<Probe />));
    return () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    };
  }

  const mountCodeMode = () =>
    mount((hooks) => () => hooks.useCodeMode(API_BASE));

  /** Mounts with the mode read succeeding and every save answered by `save`. */
  async function loadedCodeMode(save: () => Promise<Response>) {
    fetchMock.mockImplementation((_url, init) =>
      isPost(init) ? save() : Promise.resolve(json(LOADED_MODE)),
    );
    const current = await mountCodeMode();
    await act(async () => {
      await vi.waitFor(() => expect(current().isLoading).toBe(false));
    });
    return current;
  }

  it("sends the new mode and adopts the server's answer without reporting", async () => {
    const current = await loadedCodeMode(async () =>
      json({ devMode: true, canToggle: false }),
    );

    await act(async () => current().setCodeMode(true));

    const post = fetchMock.mock.calls.find(([, init]) => isPost(init));
    expect(post?.[0]).toBe(`${API_BASE}/mode`);
    expect(post?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ devMode: true });
    expect(current().isCodeMode).toBe(true);
    expect(current().canToggle).toBe(false);
    expect(reports).toEqual([]);
  });

  it("shows the new mode while the save is in flight, then reports the refusal and rolls back", async () => {
    let release: (response: Response) => void = () => {};
    const current = await loadedCodeMode(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    let inFlight: Promise<void> = Promise.resolve();
    await act(async () => {
      inFlight = current().setCodeMode(true);
    });
    expect(current().isCodeMode).toBe(true);
    expect(reports).toEqual([]);

    await act(async () => {
      release(json({ error: "Service unavailable" }, 503));
      await inFlight;
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.error).toBeInstanceOf(Error);
    expect((reports[0]?.error as { status?: number }).status).toBe(503);
    expect(current().isCodeMode).toBe(false);
    expect(current().canToggle).toBe(true);
  });

  it("reports a network error as thrown and rolls back", async () => {
    const failure = new TypeError("Failed to fetch");
    const current = await loadedCodeMode(() => Promise.reject(failure));

    await act(async () => current().setCodeMode(true));

    expect(reports).toHaveLength(1);
    expect(reports[0]?.error).toBe(failure);
    expect(current().isCodeMode).toBe(false);
    expect(current().canToggle).toBe(true);
  });

  it("reports an accepted save whose body cannot be read and rolls back", async () => {
    const current = await loadedCodeMode(
      async () => new Response("<html>gateway</html>", { status: 200 }),
    );

    await act(async () => current().setCodeMode(true));

    expect(reports).toHaveLength(1);
    expect(reports[0]?.error).toBeInstanceOf(SyntaxError);
    expect(current().isCodeMode).toBe(false);
  });

  it.each([
    [
      "refused with a status",
      () => Promise.resolve(json({ error: "Internal server error" }, 500)),
      (error: unknown) => (error as { status?: number }).status,
      500,
    ],
    [
      "thrown by the network",
      () => Promise.reject(new TypeError("Failed to fetch")),
      (error: unknown) => (error as Error).message,
      "Failed to fetch",
    ],
  ])(
    "reports a save %s and keeps the optimistic mode when the first read never loaded",
    async (_name, respond, describeError, expected) => {
      fetchMock.mockImplementation((_url, init) =>
        isPost(init) ? respond() : never<Response>(),
      );
      const current = await mountCodeMode();
      expect(current().isLoading).toBe(true);

      await act(async () => current().setCodeMode(true));

      expect(reports).toHaveLength(1);
      expect(describeError(reports[0]?.error)).toBe(expected);
      expect(current().isCodeMode).toBe(true);
      expect(current().canToggle).toBe(true);
    },
  );

  it("reports a failed save from the deprecated useDevMode alias and rolls back", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      isPost(init) ? json({}, 502) : json(LOADED_MODE),
    );
    const current = await mount((hooks) => () => hooks.useDevMode(API_BASE));
    await act(async () => {
      await vi.waitFor(() => expect(current().isLoading).toBe(false));
    });

    await act(async () => current().setDevMode(true));

    expect(reports).toHaveLength(1);
    expect((reports[0]?.error as { status?: number }).status).toBe(502);
    expect(current().isDevMode).toBe(false);
  });
});
