// @vitest-environment happy-dom

import type {
  DesktopIdentityAuthRequest,
  DesktopIdentityAuthResult,
  DesktopIdentityMagicLinkRequest,
  DesktopIdentityMagicLinkResult,
} from "@shared/ipc-channels";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesktopIdentityGate from "./DesktopIdentityGate.js";

describe("DesktopIdentityGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderGate(
    status: DesktopIdentityStatus | "checking" = "sign-in-required",
    overrides: {
      onSignIn?: () => boolean | Promise<boolean>;
      onAuthenticate?: (
        request: DesktopIdentityAuthRequest,
      ) => Promise<DesktopIdentityAuthResult>;
      onMagicLink?: (
        request: DesktopIdentityMagicLinkRequest,
      ) => Promise<DesktopIdentityMagicLinkResult>;
    } = {},
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onSignIn = overrides.onSignIn ?? vi.fn(async () => true);
    const onAuthenticate =
      overrides.onAuthenticate ?? vi.fn(async () => ({ ok: true }));
    const onMagicLink =
      overrides.onMagicLink ??
      vi.fn(async () => ({
        ok: true,
        pending: true,
        email: "owner@example.com",
      }));
    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status={status}
          onSignIn={onSignIn}
          onAuthenticate={onAuthenticate}
          onMagicLink={onMagicLink}
        />,
      );
    });
    return { onSignIn, onAuthenticate, onMagicLink };
  }

  it("renders the canonical Google-first parent form", async () => {
    const { onSignIn } = renderGate();

    expect(container.textContent).toContain("Sign in with Google");
    expect(container.textContent).toContain("Welcome");
    expect(container.textContent).toContain("Create an account or sign in");
    expect(container.textContent).toContain("Email");
    expect(container.textContent).toContain(
      "By signing up, you accept our Terms and Privacy Policy.",
    );
    expect(container.textContent).not.toContain("Continue");
    expect(
      container.querySelector('input[placeholder="you@example.com"]'),
    ).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();

    const email = container.querySelector(
      'input[placeholder="you@example.com"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(email, "owner@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Continue");

    await act(async () => {
      container
        .querySelector(".desktop-identity-gate__provider")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("does not show the email submit button while Google sign-in is pending", async () => {
    let resolveSignIn: ((result: boolean) => void) | undefined;
    const onSignIn = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    renderGate("sign-in-required", { onSignIn });
    const email = container.querySelector(
      'input[placeholder="you@example.com"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(email, "owner@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Continue");

    await act(async () => {
      container
        .querySelector(".desktop-identity-gate__provider")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Sending...");
    expect(
      container.querySelector(".desktop-identity-gate__submit"),
    ).toBeNull();

    await act(async () => {
      resolveSignIn?.(true);
    });
  });

  it("reveals only the password fallback when selected", () => {
    const { onAuthenticate } = renderGate();
    const modeLink = container.querySelector(
      ".desktop-identity-gate__mode-link",
    );
    act(() => {
      modeLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).toContain("Use a sign-in link instead");
    expect(onAuthenticate).not.toHaveBeenCalled();
  });

  it("shows the magic-link confirmation after the request is accepted", async () => {
    const { onMagicLink } = renderGate();
    const email = container.querySelector(
      'input[placeholder="you@example.com"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(email, "owner@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onMagicLink).toHaveBeenCalledWith({ email: "owner@example.com" });
    expect(container.textContent).toContain("Check your email");
  });

  it("keeps the app covered while the broker checks the session", () => {
    renderGate("checking");
    expect(container.textContent).toContain("Checking...");
    expect(container.querySelector("form")).toBeNull();
  });

  it("renders nothing after the broker has fanned out app sessions", () => {
    renderGate("signed-in");
    expect(container.textContent).toBe("");
  });
});
