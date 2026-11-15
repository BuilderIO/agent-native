// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "../i18n/en-US";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enUS,
      ),
}));

import { DesignAccessState } from "./DesignAccessState";

describe("DesignAccessState signed-out", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter>
          <DesignAccessState
            accessStatus={{
              exists: true,
              hasAccess: false,
              signedIn: false,
              viewerEmail: null,
              viewerName: null,
              role: null,
              visibility: "private",
            }}
            signInHref="/sign-in"
            onRequestAccess={vi.fn()}
            onRetryAccessCheck={vi.fn()}
          />
        </MemoryRouter>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("offers one action per button and groups the two buttons", () => {
    const signIn =
      container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]');
    const back = container.querySelector<HTMLAnchorElement>('a[href="/home"]');
    expect(signIn?.textContent).toBe("Sign in");
    expect(back?.textContent).toBe("Back to designs");
    expect(signIn?.parentElement).toBe(back?.parentElement);
    expect(signIn?.parentElement?.className).toContain("gap-2");
    // Outlined, so it reads as a button when not hovered.
    expect(back?.className).toContain("border");
  });
});
