// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navLinkSpy = vi.fn(
  (props: Record<string, unknown>) => <a {...(props as object)} />,
);
vi.mock("react-router", () => ({
  NavLink: (props: Record<string, unknown>) => navLinkSpy(props),
}));

const { AppNavLink } = await import("./app-nav-link.js");

describe("AppNavLink", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    navLinkSpy.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("defaults prefetch to intent so the route module loads before the click", () => {
    act(() => {
      root.render(<AppNavLink to="/gallery">Gallery</AppNavLink>);
    });

    expect(navLinkSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/gallery", prefetch: "intent" }),
    );
  });

  it("lets callers override prefetch", () => {
    act(() => {
      root.render(
        <AppNavLink to="/gallery" prefetch="render">
          Gallery
        </AppNavLink>,
      );
    });

    expect(navLinkSpy).toHaveBeenCalledWith(
      expect.objectContaining({ prefetch: "render" }),
    );
  });
});
