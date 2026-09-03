// @vitest-environment happy-dom

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

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: ({ returnTo }: { returnTo?: string } = {}) =>
    `/_agent-native/sign-in?return=${encodeURIComponent(returnTo ?? "/")}`,
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
    expect(buildSignUpReturnHref("/share/clip-1?at=90")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip-1%3Fat%3D90&tab=signup",
    );

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
    expect(links[1]?.textContent).toContain("signInPrompt.createAccount");
    expect(links[1]?.getAttribute("href")).toContain("tab=signup");
    expect(document.body.textContent).toContain(
      "signInPrompt.title:signInPrompt.commentIntent",
    );
  });
});
