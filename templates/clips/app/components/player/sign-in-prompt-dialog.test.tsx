// @vitest-environment happy-dom

import { decodeContinuation } from "@agent-native/core/shared/sign-in-journey";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSignUpReturnHref,
  SignInPromptDialog,
} from "./sign-in-prompt-dialog";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars?.intent ? `${key}:${vars.intent}` : key,
}));

describe("SignInPromptDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens account creation first and preserves the shared clip return path", () => {
    const signUpHref = new URL(
      buildSignUpReturnHref("/share/clip-1?at=90"),
      "http://localhost",
    );
    expect(signUpHref.pathname).toBe("/sign-in");
    expect(decodeContinuation(signUpHref.searchParams.get("c"))).toBe(
      "/share/clip-1?at=90",
    );
    expect(signUpHref.searchParams.get("tab")).toBe("signup");

    act(() => {
      root.render(
        <SignInPromptDialog
          open
          onOpenChange={vi.fn()}
          intent="comment"
          returnTo="/share/clip-1?at=90"
        />,
      );
    });

    const links = Array.from(document.body.querySelectorAll("a"));
    expect(links[0]?.textContent).toContain("signInPrompt.signIn");
    const signInHref = new URL(
      links[0]?.getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(signInHref.pathname).toBe("/sign-in");
    expect(decodeContinuation(signInHref.searchParams.get("c"))).toBe(
      "/share/clip-1?at=90",
    );
    expect(links[1]?.textContent).toContain("signInPrompt.createAccount");
    const signUpLink = new URL(
      links[1]?.getAttribute("href") ?? "",
      "http://localhost",
    );
    expect(signUpLink.searchParams.get("tab")).toBe("signup");
    expect(document.body.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "signInPrompt.title:signInPrompt.commentIntent",
    );
    expect(document.body.textContent).not.toContain("Welcome");
    expect(document.body.textContent).not.toContain("signInPrompt.description");
    expect(links[0]?.className).toContain("h-10");
    expect(links[0]?.className).toContain("px-6");
    expect(links[1]?.className).toContain("h-10");
    expect(links[1]?.className).toContain("px-6");
  });

  it("uses the modal callback instead of navigating for account creation", () => {
    const onCreateAccount = vi.fn();
    const onSignUp = vi.fn();

    act(() => {
      root.render(
        <SignInPromptDialog
          open
          onOpenChange={vi.fn()}
          intent="react"
          onCreateAccount={onCreateAccount}
          onSignUp={onSignUp}
        />,
      );
    });

    const createButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("signInPrompt.createAccount"),
    );
    expect(createButton).not.toBeUndefined();
    expect(createButton?.closest("a")).toBeNull();

    act(() => createButton?.click());

    expect(onSignUp).toHaveBeenCalledOnce();
    expect(onCreateAccount).toHaveBeenCalledOnce();
  });
});
