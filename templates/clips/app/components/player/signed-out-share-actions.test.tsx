// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildShareSignInHref,
  buildShareSignUpHref,
  SignedOutShareActions,
} from "./signed-out-share-actions";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: ({ returnTo }: { returnTo?: string } = {}) =>
    `/_agent-native/sign-in?return=${encodeURIComponent(returnTo ?? "/")}`,
}));

describe("SignedOutShareActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows sign-in and free-account links that return to the shared clip", () => {
    expect(buildShareSignInHref("clip/1")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1",
    );
    expect(buildShareSignUpHref("clip/1")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1&tab=signup",
    );

    act(() => {
      root.render(<SignedOutShareActions recordingId="clip/1" />);
    });

    const signInLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1"]',
    );
    expect(signInLink).not.toBeNull();
    expect(signInLink?.textContent).toContain("sharePage.signIn");
    expect(container.textContent).toContain("sharePage.getClipsFree");
  });

  it("preserves only the timestamp in the sign-in return path", () => {
    expect(buildShareSignInHref("clip/1", "90")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1%3Fat%3D90",
    );

    act(() => {
      root.render(
        <SignedOutShareActions recordingId="clip/1" startAt="1:30" />,
      );
    });

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1%3Fat%3D1%253A30",
    );
    expect(container.querySelectorAll("a")[1]?.getAttribute("href")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1%3Fat%3D1%253A30&tab=signup",
    );
  });

  it("tracks both signed-out header destinations", () => {
    const onCtaClick = vi.fn();

    act(() => {
      root.render(
        <SignedOutShareActions recordingId="clip-1" onCtaClick={onCtaClick} />,
      );
    });

    const links = Array.from(container.querySelectorAll("a"));
    act(() => links[0]?.click());
    act(() => links[1]?.click());

    expect(onCtaClick).toHaveBeenNthCalledWith(1, "signin");
    expect(onCtaClick).toHaveBeenNthCalledWith(2, "signup");
  });
});
