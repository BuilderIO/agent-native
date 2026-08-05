// @vitest-environment happy-dom

import { act, type ComponentProps, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VisualEditPage from "./VisualEdit";

const mocks = vi.hoisted(() => ({
  buildSignInReturnHref: vi.fn(
    (_options?: { returnTo?: string }) =>
      "/_agent-native/sign-in?c=hydration-safe-continuation",
  ),
  session: null as { email: string } | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: mocks.session }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: (options: { returnTo?: string }) =>
    mocks.buildSignInReturnHref(options),
}));

vi.mock("react-router", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.session = null;
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

describe("VisualEditPage hydration", () => {
  it("defers the anonymous sign-in href through hydration, then adds its continuation", async () => {
    const html = renderToString(<VisualEditPage />);
    expect(html).not.toContain("/_agent-native/sign-in");
    expect(html).not.toContain("?c=hydration-safe-continuation");
    expect(mocks.buildSignInReturnHref).not.toHaveBeenCalled();

    container.innerHTML = html;
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <VisualEditPage />, {
        onRecoverableError: recoverableError,
      });
    });

    expect(recoverableError).not.toHaveBeenCalled();
    expect(mocks.buildSignInReturnHref).toHaveBeenCalledWith({
      returnTo: "/visual-edit?intent=save",
    });
    expect(container.querySelector("main a[href*='?c=']")).not.toBeNull();
  });

  it("does not reconcile the anonymous shell to an account link before hydration", async () => {
    const html = renderToString(<VisualEditPage />);
    container.innerHTML = html;
    mocks.session = { email: "editor@example.com" };
    const recoverableError = vi.fn();

    await act(async () => {
      root = hydrateRoot(container, <VisualEditPage />, {
        onRecoverableError: recoverableError,
      });
    });

    expect(recoverableError).not.toHaveBeenCalled();
    expect(mocks.buildSignInReturnHref).not.toHaveBeenCalled();
    expect(
      container.querySelector("main a[aria-label]")?.getAttribute("href"),
    ).toBe("/");
  });
});
