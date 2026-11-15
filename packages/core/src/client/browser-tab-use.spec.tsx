// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setClientAppState = vi.fn(async () => null);
const deleteClientAppState = vi.fn(async () => {});

vi.mock("./application-state.js", () => ({
  setClientAppState: (...args: unknown[]) => setClientAppState(...args),
  deleteClientAppState: (...args: unknown[]) => deleteClientAppState(...args),
}));
vi.mock("./browser-tab-id.js", () => ({
  getBrowserTabId: () => "tab-1",
}));

let focused = true;
let now = 1_000_000;
const roots: Root[] = [];

async function renderUse(routes: string[]) {
  vi.resetModules();
  const { useBrowserTabUse } = await import("./browser-tab-use.js");
  function Probe({ route }: { route: string }) {
    useBrowserTabUse(route);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const render = (route: string) =>
    act(() => {
      root.render(
        <>
          {routes.map((_, index) => (
            <Probe key={index} route={route} />
          ))}
        </>,
      );
    });
  await render(routes[0]!);
  return { render };
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function records(): number {
  return setClientAppState.mock.calls.length;
}

beforeEach(() => {
  focused = true;
  now = 1_000_000;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  setClientAppState.mockClear();
  deleteClientAppState.mockClear();
});

describe("useBrowserTabUse", () => {
  it("records a focused tab once when it mounts, however many components use it", async () => {
    await renderUse(["/a", "/a"]);

    expect(setClientAppState).toHaveBeenCalledTimes(1);
    expect(setClientAppState).toHaveBeenCalledWith(
      "browser-tab-used",
      { usedAt: now },
      { requestSource: "tab-1" },
    );
  });

  it("doesn't record a tab opened in the background until it gains focus", async () => {
    focused = false;
    await renderUse(["/a"]);
    expect(records()).toBe(0);

    focused = true;
    window.dispatchEvent(new Event("focus"));

    expect(records()).toBe(1);
  });

  it("records again when focus comes back from elsewhere, not from the page's own frames", async () => {
    await renderUse(["/a"]);

    // Focus moves into one of the page's frames: the page still has focus.
    window.dispatchEvent(new Event("blur"));
    await settle();
    window.dispatchEvent(new Event("focus"));
    expect(records()).toBe(1);

    // Focus leaves for another tab, then comes back.
    focused = false;
    window.dispatchEvent(new Event("blur"));
    await settle();
    focused = true;
    window.dispatchEvent(new Event("focus"));
    expect(records()).toBe(2);
  });

  it("refreshes the record on a route change at most once a minute", async () => {
    const { render } = await renderUse(["/a"]);

    now += 30_000;
    await render("/b");
    expect(records()).toBe(1);

    now += 30_000;
    await render("/c");
    expect(records()).toBe(2);
  });

  it("forgets the tab when the page goes away and records it again when restored from the back-forward cache", async () => {
    await renderUse(["/a"]);

    window.dispatchEvent(new Event("pagehide"));
    expect(deleteClientAppState).toHaveBeenCalledWith("browser-tab-used", {
      keepalive: true,
      requestSource: "tab-1",
    });

    const pageShow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);
    expect(records()).toBe(2);
  });

  it("stops listening once nothing uses it", async () => {
    await renderUse(["/a"]);
    for (const root of roots.splice(0)) act(() => root.unmount());

    focused = false;
    window.dispatchEvent(new Event("blur"));
    await settle();
    focused = true;
    window.dispatchEvent(new Event("focus"));

    expect(records()).toBe(1);
  });
});
