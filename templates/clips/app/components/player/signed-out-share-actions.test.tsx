// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  buildShareCopyHref,
  buildShareSignInHref,
  buildShareSignUpHref,
  SignedOutShareActions,
} from "./signed-out-share-actions";

const writeClipboardText = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

vi.mock("@agent-native/core/client/clipboard", () => ({
  writeClipboardText,
}));

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
    writeClipboardText.mockReset();
    trackEvent.mockReset();
    writeClipboardText.mockResolvedValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderActions(
    props: React.ComponentProps<typeof SignedOutShareActions>,
  ) {
    act(() => {
      root.render(
        <TooltipProvider delayDuration={0}>
          <SignedOutShareActions {...props} />
        </TooltipProvider>,
      );
    });
  }

  it("shows sign-in and free-account links that return to the shared clip", () => {
    expect(buildShareSignInHref("clip/1")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1",
    );
    expect(buildShareSignUpHref("clip/1")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1&tab=signup",
    );

    renderActions({ recordingId: "clip/1" });

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

    renderActions({ recordingId: "clip/1", startAt: "1:30" });

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1%3Fat%3D1%253A30",
    );
    expect(container.querySelectorAll("a")[1]?.getAttribute("href")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip%2F1%3Fat%3D1%253A30&tab=signup",
    );
  });

  it("tracks both signed-out header destinations", () => {
    const onCtaClick = vi.fn();

    renderActions({ recordingId: "clip-1", onCtaClick });

    const links = Array.from(container.querySelectorAll("a"));
    act(() => links[0]?.click());
    act(() => links[1]?.click());

    expect(onCtaClick).toHaveBeenNthCalledWith(1, "signin");
    expect(onCtaClick).toHaveBeenNthCalledWith(2, "signup");
  });

  it("opens the in-place signup flow when a modal handler is provided", () => {
    const onSignup = vi.fn();
    const onCtaClick = vi.fn();

    renderActions({
      recordingId: "clip-1",
      onCtaClick,
      onSignup,
    });

    const signupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("sharePage.getClipsFree"),
    );
    expect(signupButton).not.toBeUndefined();
    expect(signupButton?.closest("a")).toBeNull();

    act(() => signupButton?.click());

    expect(onCtaClick).toHaveBeenCalledWith("signup");
    expect(onSignup).toHaveBeenCalledOnce();
  });

  it("renders a split free-account CTA with a copy-link fast path", async () => {
    expect(buildShareCopyHref("clip-1")).toContain(
      "/share/clip-1?ref=clip_share",
    );
    expect(buildShareCopyHref("clip-1", "1:30")).toContain(
      "/share/clip-1?ref=clip_share&at=1%3A30",
    );

    renderActions({ recordingId: "clip-1", startAt: "90" });

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="recordRoute.copyLinkAction"]',
    );
    expect(copyButton).not.toBeNull();
    expect(container.textContent).toContain("sharePage.getClipsFree");

    await act(async () => {
      copyButton?.click();
      await Promise.resolve();
    });

    expect(writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("/share/clip-1?ref=clip_share&at=90"),
    );
    expect(trackEvent).toHaveBeenCalledWith("share_link_copied", {
      resource_type: "recording",
      resource_id: "clip-1",
      link_type: "share",
    });
    expect(copyButton?.getAttribute("aria-label")).toBe(
      "recordRoute.linkCopied",
    );
  });
});
