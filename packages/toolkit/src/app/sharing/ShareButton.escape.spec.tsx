// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { ShareButton } from "./ShareButton.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

vi.mock("@agent-native/core/client/use-action", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActionQuery: () => ({
    data: {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [],
    },
    isError: false,
    refetch: vi.fn(async () => undefined),
  }),
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const bubbledEscapes: KeyboardEvent[] = [];
const recordEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") bubbledEscapes.push(event);
};

function pressEscape(target: Element) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("share invite Escape", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const inviteInput = () => {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="Add people by email"]',
    );
    if (!input) throw new Error("Invite input not found");
    return input;
  };
  const sharePanel = () =>
    document.body.querySelector('[data-state="open"].w-\\[384px\\]');
  const listbox = () => document.body.querySelector('[role="listbox"]');

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider catalogs={[toolkitI18nCatalog]}>
            <TooltipProvider>
              <ShareButton
                resourceType="document"
                resourceId="doc-1"
                resourceTitle="Doc"
                defaultOpen
                autoFocusInvite
              />
            </TooltipProvider>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(sharePanel()).toBeTruthy());
  }

  beforeEach(() => {
    bubbledEscapes.length = 0;
    document.addEventListener("keydown", recordEscape);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/_agent-native/org/members") &&
        String(input).includes("search=aka")
          ? Response.json({
              members: [
                { email: "akash@builder.io", name: "Akash", role: "member" },
              ],
              hasMore: false,
              nextOffset: null,
            })
          : Response.json({ members: [] }),
      ),
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    document.removeEventListener("keydown", recordEscape);
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("closes the share panel on Escape from a focused, empty invite input", async () => {
    await mount();
    const input = inviteInput();
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(listbox()).toBeNull();
    expect(sharePanel()).toBeTruthy();

    pressEscape(input);

    expect(bubbledEscapes).toHaveLength(1);
    expect(sharePanel()).toBeNull();
  });

  it("closes only the suggestion list on the first Escape, then the share panel", async () => {
    await mount();
    const input = inviteInput();
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, "aka");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(() => expect(listbox()).toBeTruthy());
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(listbox()).toBeTruthy();

    pressEscape(input);
    expect(listbox()).toBeNull();
    expect(sharePanel()).toBeTruthy();
    expect(bubbledEscapes).toHaveLength(0);

    pressEscape(input);
    expect(bubbledEscapes).toHaveLength(1);
    expect(sharePanel()).toBeNull();
  });

  it("closes the share panel on Escape while the closed suggestion list is still exiting", async () => {
    const style = document.createElement("style");
    style.textContent =
      '[data-agent-native-share-overlay][data-state="closed"] { animation-name: share-exit; animation-duration: 150ms; }';
    document.head.appendChild(style);
    const probe = document.createElement("div");
    probe.setAttribute("data-agent-native-share-overlay", "");
    probe.setAttribute("data-state", "closed");
    document.body.appendChild(probe);
    expect(getComputedStyle(probe).animationName).toBe("share-exit");
    probe.remove();
    try {
      await mount();
      const input = inviteInput();
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        setter?.call(input, "aka");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await vi.waitFor(() => expect(listbox()).toBeTruthy());

      pressEscape(input);
      expect(
        document.body.querySelector(
          '[data-agent-native-share-overlay][data-state="closed"]',
        ),
      ).toBeNull();
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(sharePanel()).toBeTruthy();

      pressEscape(input);
      expect(sharePanel()).toBeNull();
    } finally {
      style.remove();
    }
  });
});
