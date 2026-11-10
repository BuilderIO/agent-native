// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentShareSection } from "./AgentShareSection.js";

const mocks = vi.hoisted(() => ({
  mint: vi.fn(),
  copy: vi.fn(async (_text: string) => true),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
}));
vi.mock("@agent-native/core/client/use-action", () => ({
  useActionMutation: () => ({ mutate: mocks.mint, isPending: false }),
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.copy,
}));

type MintCallbacks = {
  onSuccess: (result: { contextUrl?: string; expiresAt?: string }) => void;
};

describe("AgentShareSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.mint.mockReset();
    mocks.copy.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    const found = Array.from(container.querySelectorAll("button")).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent.trim() === label,
    );
    if (!found) throw new Error(`No ${label} button`);
    return found;
  }

  async function openWithLink(expiresInMs: number) {
    await act(async () => {
      root.render(
        <AgentShareSection resourceType="deck" resourceId="deck-1" enabled />,
      );
    });
    await act(async () => button("Share with agents").click());
    expect(mocks.mint).toHaveBeenCalledTimes(1);
    const [, callbacks] = mocks.mint.mock.calls[0] as [unknown, MintCallbacks];
    act(() =>
      callbacks.onSuccess({
        contextUrl: "https://slides.agent-native.com/agent/first",
        expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      }),
    );
  }

  it("copies a link that is still good, and keeps it when reopened", async () => {
    await openWithLink(2 * 60 * 60_000);

    await act(async () => button("Copy").click());
    expect(mocks.copy).toHaveBeenCalledWith(
      "https://slides.agent-native.com/agent/first",
    );

    await act(async () => button("Share with agents").click());
    await act(async () => button("Share with agents").click());
    expect(mocks.mint).toHaveBeenCalledTimes(1);
  });

  it("fetches a fresh link instead of copying one about to expire", async () => {
    await openWithLink(30_000);

    await act(async () => button("Copy").click());

    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.mint).toHaveBeenCalledTimes(2);
  });

  it("fetches a fresh link when reopened after the old one expired", async () => {
    await openWithLink(30_000);

    await act(async () => button("Share with agents").click());
    await act(async () => button("Share with agents").click());

    expect(mocks.mint).toHaveBeenCalledTimes(2);
  });
});
