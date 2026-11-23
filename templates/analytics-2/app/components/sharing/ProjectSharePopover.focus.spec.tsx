// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import enUS from "@/i18n/en-US";

import { ProjectSharePopover } from "./ProjectSharePopover";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./AppEmbeddingSection", () => ({
  AppEmbeddingSection: () => null,
}));

function installMatchMedia() {
  let matches = false;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    media: "(max-width: 639px)",
    get matches() {
      return matches;
    },
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    setSmallScreen(next: boolean) {
      matches = next;
      const event = { matches: next, media: mql.media } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Share
      </button>
      <button type="button">Outside action</button>
      {open ? (
        <ProjectSharePopover
          projectId="prj_focus"
          title="Focus test"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

describe("A2-SHARE-HIDDEN-INVITE-ESCAPE: ProjectSharePopover focus restoration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let media: ReturnType<typeof installMatchMedia>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("list-resource-shares")) {
          return Response.json({
            ownerEmail: "owner@example.com",
            orgId: null,
            visibility: "private",
            role: "owner",
            shares: [],
          });
        }
        return Response.json({ members: [] });
      }),
    );
    media = installMatchMedia();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  });

  async function renderHarness() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <TooltipProvider>
              <Harness />
            </TooltipProvider>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
  }

  it("restores focus to the Share button on Escape after a narrow-viewport Sheet swap", async () => {
    await renderHarness();
    const shareButton = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Share",
    );
    if (!shareButton) throw new Error("Share button missing");
    await act(async () => {
      shareButton.focus();
      shareButton.click();
    });
    await vi.waitFor(() => {
      expect(
        document.body.querySelector<HTMLInputElement>('input[role="combobox"]'),
      ).toBeTruthy();
    });
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");

    await act(async () => {
      media.setSmallScreen(true);
    });
    await vi.waitFor(() => {
      expect(
        document.body.querySelector<HTMLInputElement>('input[role="combobox"]'),
      ).toBeTruthy();
    });

    await act(async () => {
      media.setSmallScreen(false);
    });
    await vi.waitFor(() => {
      expect(
        document.body.querySelector<HTMLInputElement>('input[role="combobox"]'),
      ).toBeTruthy();
    });

    const invite = document.body.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    if (!invite) throw new Error("Invite input missing");
    if (invite.getAttribute("aria-expanded") === "true") {
      await act(async () => {
        invite.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    await act(async () => {
      invite.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await vi.waitFor(() => {
      expect(
        document.body.querySelector("[data-agent-native-share-overlay]"),
      ).toBeNull();
    });
    expect(document.activeElement).toBe(shareButton);
  });

  it("does not steal focus back to Share when dismissed by clicking outside", async () => {
    await renderHarness();
    const buttons = [...host.querySelectorAll("button")];
    const shareButton = buttons.find((btn) => btn.textContent === "Share");
    const outsideButton = buttons.find(
      (btn) => btn.textContent === "Outside action",
    );
    if (!shareButton || !outsideButton) {
      throw new Error("Harness buttons missing");
    }
    await act(async () => {
      shareButton.focus();
      shareButton.click();
    });
    await vi.waitFor(() => {
      expect(
        document.body.querySelector<HTMLInputElement>('input[role="combobox"]'),
      ).toBeTruthy();
    });

    await vi.waitFor(async () => {
      await act(async () => {
        outsideButton.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        outsideButton.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        outsideButton.focus();
      });
      expect(
        document.body.querySelector("[data-agent-native-share-overlay]"),
      ).toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).not.toBe(shareButton);
  });
});
