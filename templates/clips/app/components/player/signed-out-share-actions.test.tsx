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

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function expectSignInHref(
  href: string | null | undefined,
  returnTo: string,
  tab?: "signup",
) {
  expect(href).toBeTypeOf("string");
  const url = new URL(href!, "https://clips.example.test");
  expect(url.pathname).toBe("/sign-in");
  const continuation = url.searchParams.get("c");
  expect(continuation).not.toBeNull();
  expect(
    decodeURIComponent(
      atob(continuation!.replace(/-/g, "+").replace(/_/g, "/")),
    ),
  ).toBe(returnTo);
  url.searchParams.delete("c");
  expect(Object.fromEntries(url.searchParams)).toEqual(tab ? { tab } : {});
}

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
    expectSignInHref(buildShareSignInHref("clip/1"), "/share/clip/1");
    expectSignInHref(buildShareSignUpHref("clip/1"), "/share/clip/1", "signup");

    renderActions({ recordingId: "clip/1" });

    const signInLink = container.querySelector<HTMLAnchorElement>(
      'a[href^="/sign-in?"]',
    );
    expect(signInLink).not.toBeNull();
    expectSignInHref(signInLink?.getAttribute("href"), "/share/clip/1");
    expect(signInLink?.textContent).toContain("sharePage.signIn");
    expect(container.textContent).toContain("sharePage.getClipsFree");
  });

  it("preserves only the timestamp in the sign-in return path", () => {
    expectSignInHref(
      buildShareSignInHref("clip/1", "90"),
      "/share/clip/1?at=90",
    );

    renderActions({ recordingId: "clip/1", startAt: "1:30" });

    expectSignInHref(
      container.querySelector("a")?.getAttribute("href"),
      "/share/clip/1?at=1%3A30",
    );
    expectSignInHref(
      container.querySelectorAll("a")[1]?.getAttribute("href"),
      "/share/clip/1?at=1%3A30",
      "signup",
    );
  });

  it("preserves ?panel in the visible sign-in and sign-up return paths", () => {
    expectSignInHref(
      buildShareSignInHref("clip/1", "90", "comments"),
      "/share/clip/1?at=90&panel=comments",
    );
    expectSignInHref(
      buildShareSignUpHref("clip/1", "90", "comments"),
      "/share/clip/1?at=90&panel=comments",
      "signup",
    );

    renderActions({ recordingId: "clip/1", startAt: "90", panel: "comments" });

    const links = container.querySelectorAll("a");
    expectSignInHref(
      links[0]?.getAttribute("href"),
      "/share/clip/1?at=90&panel=comments",
    );
    expectSignInHref(
      links[1]?.getAttribute("href"),
      "/share/clip/1?at=90&panel=comments",
      "signup",
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
