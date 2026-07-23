// @vitest-environment happy-dom

import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDesktopPromo } from "./use-desktop-promo";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function Probe({
  children,
}: {
  children: (value: ReturnType<typeof useDesktopPromo>) => ReactNode;
}) {
  return <>{children(useDesktopPromo())}</>;
}

describe("useDesktopPromo", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function renderProbe() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <Probe>
          {({ isDesktopApp, shouldShowSidebarLink }) => (
            <output
              data-desktop={String(isDesktopApp)}
              data-show-sidebar-link={String(shouldShowSidebarLink)}
            />
          )}
        </Probe>,
      );
    });
  }

  it("does not flash the desktop CTA inside Electron", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Agent Native Electron",
    });
    renderProbe();

    const output = container.querySelector("output");
    expect(output?.dataset.showSidebarLink).toBe("false");
    expect(output?.dataset.desktop).toBe("true");
  });

  it("shows the desktop CTA after browser runtime detection", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0",
    });
    renderProbe();

    const output = container.querySelector("output");
    expect(output?.dataset.showSidebarLink).toBe("true");
    expect(output?.dataset.desktop).toBe("false");
  });
});
