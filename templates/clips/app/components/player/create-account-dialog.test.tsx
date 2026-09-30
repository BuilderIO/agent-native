import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountGateDialog,
  buildCreateAccountHref,
} from "./create-account-dialog";

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/oauth-popup", () => ({
  openOAuthPopup: vi.fn(),
}));

vi.mock("@agent-native/core/shared", () => ({
  isQaTestEmail: () => false,
}));

vi.mock("@agent-native/core/shared/auth-copy", () => ({
  resolveNativeAuthCopy: () =>
    new Proxy({}, { get: (_target, key) => String(key) }),
}));

let mountPoint: HTMLDivElement;
let portalContainer: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mountPoint = document.createElement("div");
  portalContainer = document.createElement("div");
  document.body.append(mountPoint, portalContainer);
  root = createRoot(mountPoint);
});

afterEach(() => {
  act(() => root.unmount());
  mountPoint.remove();
  portalContainer.remove();
  vi.unstubAllGlobals();
});

describe("create account dialog", () => {
  it.each(["/share/clip-1?at=90", "/share/clip-1?at=1%3A30&ref=clip_share"])(
    "keeps the viewer continuation %s while requesting the focused signup mode",
    (returnTo) => {
      const url = new URL(
        buildCreateAccountHref(returnTo),
        "https://clips.example.test",
      );
      expect(url.pathname).toBe("/sign-in");
      const continuation = url.searchParams.get("c");
      expect(continuation).not.toBeNull();
      expect(
        decodeURIComponent(
          atob(continuation!.replace(/-/g, "+").replace(/_/g, "/")),
        ),
      ).toBe(returnTo);
      url.searchParams.delete("c");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        tab: "signup",
        initialPrompt: "1",
        embedded: "1",
      });
    },
  );

  it("composes the shared auth pattern inside the modal", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/player/create-account-dialog.tsx"),
      "utf8",
    );

    expect(source).toContain("resolveNativeAuthCopy");
    expect(source).toContain("AccountGateHeader");
    expect(source).toContain('data-auth-pattern="native"');
    expect(source).toContain("sm:max-w-md");
    expect(source).toContain("copy.welcomeTitle");
    expect(source).toContain("copy.googleButton");
    expect(source).toContain("copy.sendMagicLink");
    expect(source).toContain("copy.usePasswordInstead");
    expect(source).toContain("export function AccountGateDialog");
    expect(source).toContain("data-account-gate-intent");
    expect(source).toContain('t("signInPrompt.agentTitle")');
    expect(source).toContain('t("signInPrompt.genericTitle")');
    expect(source).toContain("/_agent-native/google/auth-url");
    expect(source).toContain("/_agent-native/auth/desktop-exchange");
    expect(source).toContain("/_agent-native/auth/magic-link");
    expect(source).toContain("oauthPopupRef");
    expect(source).toContain("openOAuthPopup");
    expect(source).toContain("closeOAuthPopup");
    expect(source).toContain("oauthRunRef.current += 1");
    expect(source).toContain('method: "google"');
    expect(source).not.toContain("IconBrandGoogle");
  });

  it("renders the account gate inside its supplied portal container", () => {
    act(() => {
      root.render(
        <AccountGateDialog
          open
          onOpenChange={() => {}}
          onAuthenticated={() => {}}
          portalContainer={portalContainer}
          returnTo="/share/clip-1"
          intent="comment"
        />,
      );
    });

    expect(
      portalContainer.querySelector('[data-account-gate-intent="comment"]'),
    ).not.toBeNull();
    expect(
      mountPoint.querySelector('[data-account-gate-intent="comment"]'),
    ).toBeNull();
  });
});
