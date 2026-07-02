import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareButton } from "./ShareButton.js";

const shareMutate = vi.hoisted(() => vi.fn());
const otherMutate = vi.hoisted(() => vi.fn());
const refetchShares = vi.hoisted(() => vi.fn(async () => undefined));
const popoverInteractOutsideHandlers = vi.hoisted(
  () =>
    [] as Array<
      (event: {
        detail: { originalEvent: { target: EventTarget | null } };
        preventDefault: () => void;
      }) => void
    >,
);
const sharesData = vi.hoisted(() => ({
  current: {
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    role: "owner",
    shares: [],
  },
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({
    data: sharesData.current,
    refetch: refetchShares,
  }),
  useActionMutation: (name: string) => ({
    mutate: name === "share-resource" ? shareMutate : otherMutate,
  }),
}));

vi.mock("../components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({
    children,
    onInteractOutside,
    onOpenAutoFocus: _onOpenAutoFocus,
    align: _align,
    sideOffset: _sideOffset,
    ...props
  }: {
    children: React.ReactNode;
    onInteractOutside?: (event: {
      detail: { originalEvent: { target: EventTarget | null } };
      preventDefault: () => void;
    }) => void;
    onOpenAutoFocus?: unknown;
    align?: unknown;
    sideOffset?: unknown;
    [key: string]: unknown;
  }) => {
    if (onInteractOutside) {
      popoverInteractOutsideHandlers.push(onInteractOutside);
    }
    return <div {...props}>{children}</div>;
  },
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ShareButton", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          members: [],
        }),
      ),
    );
    shareMutate.mockReset();
    otherMutate.mockReset();
    refetchShares.mockClear();
    popoverInteractOutsideHandlers.length = 0;
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [],
    };
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("submits a typed email invite when Done is clicked", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            resourceTitle="Launch notes"
            shareUrl="https://content.agent-native.com/page/doc-1"
          />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "teammate@example.com");

    const done = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Done",
    );
    if (!done) throw new Error("Done button not found");

    act(() => {
      done.click();
    });

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "teammate@example.com",
        role: "viewer",
        notify: true,
        resourceUrl: "https://content.agent-native.com/page/doc-1",
      }),
      expect.any(Object),
    );
  });

  it("shows the copy action for share URLs regardless of visibility", async () => {
    // Mirrors Google Slides: the copy button is always live. Access is
    // enforced when the recipient opens the URL, not by hiding the link in
    // the share dialog.
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl="https://slides.agent-native.com/deck/deck-1"
          />
        </QueryClientProvider>,
      );
    });

    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Copy",
      ),
    ).toBe(true);
  });

  it("falls back when async clipboard copy is denied", async () => {
    const shareUrl = "https://slides.agent-native.com/deck/deck-1";
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl={shareUrl}
          />
        </QueryClientProvider>,
      );
    });

    const copy = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy",
    );
    if (!copy) throw new Error("Copy button not found");

    await act(async () => {
      copy.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(shareUrl);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copy.textContent).toBe("Copied");
  });

  it("can render an icon-only trigger", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="plan"
            resourceId="plan-1"
            shareUrl="https://plan.agent-native.com/plans/plan-1"
            trigger="icon"
          />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector(
      'button[aria-label="Share"]',
    ) as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).not.toContain("Share");
  });

  it("renders the label trigger as text only for organization visibility", async () => {
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "org",
      role: "owner",
      shares: [],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            shareUrl="https://content.agent-native.com/page/doc-1"
          />
        </QueryClientProvider>,
      );
    });

    const trigger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Share",
    );

    expect(trigger).toBeTruthy();
    expect(trigger?.querySelector("svg")).toBeFalsy();
    expect(trigger?.querySelector(".animate-pulse")).toBeFalsy();
  });

  it("renders the icon-only trigger without a loading placeholder", async () => {
    sharesData.current = undefined as any;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="plan"
            resourceId="plan-1"
            shareUrl="https://plan.agent-native.com/plans/plan-1"
            trigger="icon"
          />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector(
      'button[aria-label="Share"]',
    ) as HTMLButtonElement | null;

    expect(trigger?.querySelector("svg")).toBeTruthy();
    expect(trigger?.querySelector(".animate-pulse")).toBeFalsy();
  });

  it("renders both primary and secondary share URLs", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl="https://slides.agent-native.com/deck/deck-1"
            shareUrlLabel="Editor link"
            secondaryShareUrl="https://slides.agent-native.com/p/deck-1"
            secondaryShareUrlLabel="Presentation link"
          />
        </QueryClientProvider>,
      );
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const editorInput = inputs.find(
      (i) => i.value === "https://slides.agent-native.com/deck/deck-1",
    );
    const presentationInput = inputs.find(
      (i) => i.value === "https://slides.agent-native.com/p/deck-1",
    );
    expect(editorInput).toBeTruthy();
    expect(presentationInput).toBeTruthy();
  });

  it("can customize access labels and move the share URL to the top", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            shareUrl="https://forms.agent-native.com/f/form-1"
            shareUrlLabel="Public response link"
            shareUrlPlacement="top"
            peopleAccessLabel="People with editing access"
            generalAccessLabel="General editing access"
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("People with editing access");
    expect(text).toContain("General editing access");
    expect(text.indexOf("Public response link")).toBeLessThan(
      text.indexOf("People with editing access"),
    );
  });

  it("can hide copyable share links and the done button", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareUrl="https://design.agent-native.com/design/design-1"
            shareUrlLabel="Design editor link"
            showShareLinks={false}
            showDoneButton={false}
            shareFooterContent={<button type="button">Copy share link</button>}
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("People with access");
    expect(text).toContain("General access");
    expect(text).toContain("Copy share link");
    expect(text).not.toContain("Design editor link");
    expect(text).not.toContain("Done");
  });

  it("keeps the share popover open for nested portaled share menus", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareUrl="https://design.agent-native.com/design/design-1"
          />
        </QueryClientProvider>,
      );
    });

    const handler =
      popoverInteractOutsideHandlers[popoverInteractOutsideHandlers.length - 1];
    if (!handler) throw new Error("share popover outside handler not found");

    const nestedOverlay = document.createElement("div");
    nestedOverlay.setAttribute("data-agent-native-share-overlay", "");
    const nestedItem = document.createElement("button");
    nestedOverlay.appendChild(nestedItem);
    document.body.appendChild(nestedOverlay);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    const preventNestedDismiss = vi.fn();
    handler({
      detail: { originalEvent: { target: nestedItem } },
      preventDefault: preventNestedDismiss,
    });
    expect(preventNestedDismiss).toHaveBeenCalledOnce();

    const preventOutsideDismiss = vi.fn();
    handler({
      detail: { originalEvent: { target: outside } },
      preventDefault: preventOutsideDismiss,
    });
    expect(preventOutsideDismiss).not.toHaveBeenCalled();

    nestedOverlay.remove();
    outside.remove();
  });

  it("renders optional share tabs and switches to custom tab content", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareUrl="https://design.agent-native.com/design/design-1"
            shareTabs={{
              tabs: [
                {
                  value: "export",
                  label: "Export",
                  content: <div>Export body</div>,
                },
                {
                  value: "send",
                  label: "Send to...",
                  content: <div>Send body</div>,
                },
              ],
            }}
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("Share link");
    expect(container.textContent).toContain("Export");
    expect(container.textContent).toContain("Send to...");
    expect(container.textContent).not.toContain("Export body");

    const exportTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Export",
    );
    if (!exportTab) throw new Error("Export tab not found");

    act(() => {
      exportTab.click();
    });

    expect(container.textContent).toContain("Export body");
    expect(container.textContent).not.toContain("Send body");
  });

  it("buries organization search visibility under Advanced", async () => {
    const onCheckedChange = vi.fn();
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "org",
      role: "owner",
      shares: [],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            hideInSearchControl={{
              checked: false,
              label: "Hide in search",
              description:
                "Hide from Organization and search. People with the link can still view.",
              onCheckedChange,
            }}
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Advanced");
    expect(text.indexOf("Advanced")).toBeLessThan(
      text.indexOf("Hide in search"),
    );

    const switchButton = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null;
    expect(switchButton).toBeTruthy();

    act(() => {
      switchButton?.click();
    });

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("searches org members on the server and selects a suggestion with the keyboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/_agent-native/org/members")) {
        return Response.json({
          members: [{ email: "akash@builder.io", role: "member" }],
          hasMore: false,
          nextOffset: null,
        });
      }
      return Response.json({ members: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            resourceTitle="Hackathon"
          />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "aka");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    const memberSearchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/_agent-native/org/members"),
    );
    expect(String(memberSearchCall?.[0])).toContain("search=aka");
    expect(String(memberSearchCall?.[0])).toContain("limit=25");
    expect(container.textContent).toContain("akash@builder.io");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(input.value).toBe("akash@builder.io");
  });

  it("requests the next org-member page from the share autocomplete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          members: [{ email: "first@builder.io", role: "member" }],
          hasMore: true,
          nextOffset: 25,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          members: [{ email: "second@builder.io", role: "member" }],
          hasMore: false,
          nextOffset: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="form" resourceId="form-1" />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "first");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    const loadMore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Load more",
    );
    if (!loadMore) throw new Error("Load more button not found");

    act(() => {
      loadMore.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("offset=25");
    expect(container.textContent).toContain("second@builder.io");
  });
});
