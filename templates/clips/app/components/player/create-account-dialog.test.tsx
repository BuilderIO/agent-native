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

const appBasePathState = vi.hoisted(() => ({ value: "" }));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => appBasePathState.value,
  appPath: (path: string) => {
    const basePath = appBasePathState.value;
    if (
      !basePath ||
      path === basePath ||
      path.startsWith(`${basePath}/`) ||
      !path.startsWith("/")
    ) {
      return path;
    }
    return `${basePath}${path}`;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    const template =
      key === "signInPrompt.verificationPendingCopy" ? `${key} {{email}}` : key;
    return Object.entries(values ?? {}).reduce(
      (result, [name, value]) =>
        result.split(`{{${name}}}`).join(value).split(`{${name}}`).join(value),
      template,
    );
  },
}));

vi.mock("@agent-native/core/client/oauth-popup", () => ({
  openOAuthPopup: vi.fn(),
}));

vi.mock("@agent-native/core/shared", () => ({
  isTestIdentityEmail: () => false,
}));

vi.mock("@agent-native/core/shared/auth-copy", () => ({
  resolveNativeAuthCopy: () =>
    new Proxy({}, { get: (_target, key) => String(key) }),
}));

let mountPoint: HTMLDivElement;
let portalContainer: HTMLDivElement;
let root: Root;

beforeEach(() => {
  appBasePathState.value = "";
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

  it("keeps unverified signup in the shared return flow and can resend verification", async () => {
    appBasePathState.value = "/clips";
    const returnTo = "/share/clip-1?at=90&ref=clip_share";
    const callbackURL = buildCreateAccountHref(returnTo);
    const mountedReturnTo = `/clips${returnTo}`;
    const email = "viewer@example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Your email is not verified yet." }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "Email provider unavailable" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(
        <AccountGateDialog
          open
          onOpenChange={() => {}}
          onAuthenticated={() => {}}
          portalContainer={portalContainer}
          returnTo={returnTo}
          intent="comment"
        />,
      );
    });

    const passwordToggle = Array.from(
      portalContainer.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("usePasswordInstead"));
    await act(async () => {
      passwordToggle?.click();
    });

    const setInputValue = (id: string, value: string) => {
      const input = portalContainer.querySelector<HTMLInputElement>(`#${id}`);
      expect(input).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => {
      setInputValue("create-account-email", email);
      setInputValue("create-account-password", "a-long-password-123");
      setInputValue(
        "create-account-password-confirmation",
        "a-long-password-123",
      );
    });

    const form = portalContainer.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/clips/_agent-native/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email,
          password: "a-long-password-123",
          callbackURL,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/clips/_agent-native/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(portalContainer.textContent).toContain(
      "signInPrompt.verificationPendingTitle",
    );
    expect(portalContainer.textContent).toContain(email);

    const signInLink = portalContainer.querySelector<HTMLAnchorElement>(
      'a[href^="/clips/sign-in?"]',
    );
    expect(signInLink).not.toBeNull();
    const signInUrl = new URL(signInLink!.href, "https://clips.example.test");
    expect(
      decodeURIComponent(
        atob(
          signInUrl.searchParams
            .get("c")!
            .replace(/-/g, "+")
            .replace(/_/g, "/"),
        ),
      ),
    ).toBe(mountedReturnTo);

    const resendButton = Array.from(
      portalContainer.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("signInPrompt.resendVerification"),
    );
    await act(async () => {
      resendButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/clips/_agent-native/auth/ba/send-verification-email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email, callbackURL }),
      }),
    );
    expect(portalContainer.textContent).toContain(
      "signInPrompt.verificationEmailFailed",
    );

    const retryButton = Array.from(
      portalContainer.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("signInPrompt.resendVerification"),
    );
    await act(async () => {
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/clips/_agent-native/auth/ba/send-verification-email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email, callbackURL }),
      }),
    );
    expect(portalContainer.textContent).toContain(
      "signInPrompt.verificationEmailResent",
    );
  });
});
