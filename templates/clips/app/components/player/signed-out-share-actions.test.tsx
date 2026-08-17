// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildShareSignInHref,
  SignedOutShareActions,
} from "./signed-out-share-actions";

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  appPath: (path: string) => `/clips${path}`,
  useT: () => (key: string) => key,
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

  it("shows a sign-in link that returns to the shared clip", () => {
    expect(buildShareSignInHref("clip/1")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1",
    );

    act(() => {
      root.render(<SignedOutShareActions recordingId="clip/1" />);
    });

    const signInLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1"]',
    );
    expect(signInLink).not.toBeNull();
    expect(signInLink?.textContent).toContain("sharePage.signIn");
    expect(container.textContent).toContain("sharePage.tryClips");
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
    expect(onCtaClick).toHaveBeenNthCalledWith(2, "try_clips");
  });
});
