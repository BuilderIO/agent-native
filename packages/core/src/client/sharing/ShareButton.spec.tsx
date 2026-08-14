import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
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
const popoverOpenChangeHandlers = vi.hoisted(
  () => [] as Array<(open: boolean) => void>,
);
const popoverTestState = vi.hoisted(() => ({
  simulateMounting: false,
}));
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

vi.mock("../components/ui/popover.js", () => {
  const PopoverOpenContext = React.createContext(true);
  const isOuterSharePopover = (node: React.ReactNode): boolean =>
    React.Children.toArray(node).some((child) => {
      if (!React.isValidElement(child)) return false;
      const props = child.props as { children?: React.ReactNode } & Record<
        string,
        unknown
      >;
      return String(props.className ?? "").includes("w-[min(460px,92vw)]");
    });

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      if (
        onOpenChange &&
        typeof open === "boolean" &&
        isOuterSharePopover(children)
      ) {
        popoverOpenChangeHandlers.push(onOpenChange);
      }
      return isOuterSharePopover(children) ? (
        <PopoverOpenContext.Provider
          value={popoverTestState.simulateMounting ? open === true : true}
        >
          <div>{children}</div>
        </PopoverOpenContext.Provider>
      ) : (
        <div>{children}</div>
      );
    },
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
      if (!React.useContext(PopoverOpenContext)) return null;
      return <div {...props}>{children}</div>;
    },
  };
});

function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
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
    popoverOpenChangeHandlers.length = 0;
    popoverTestState.simulateMounting = false;
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

  it("submits one typed email with Add while keeping the share popover open", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            resourceTitle="Launch notes"
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain('Share "Launch notes"');

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "first@example.com");

    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add",
    );
    if (!add) throw new Error("Add button not found");

    act(() => {
      add.click();
    });

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "first@example.com",
        role: "viewer",
        notify: true,
      }),
      expect.any(Object),
    );
    expect(container.textContent).not.toContain("Done");
    expect(
      container.querySelector('input[placeholder="Add people by email"]'),
    ).toBeTruthy();
  });

  it("uses commenter role copy overrides and persists the commenter role", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            roleCopy={{
              commenter: {
                label: "Commenter",
                description: "Can view and add comments",
              },
            }}
          />
        </QueryClientProvider>,
      );
    });

    const roleTrigger = container.querySelector(
      'button[aria-label="Role"]',
    ) as HTMLButtonElement | null;
    expect(roleTrigger?.textContent).toContain("Viewer");
    await act(async () => roleTrigger?.click());
    expect(document.body.textContent).toContain("Can view and add comments");
    const commenterOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Commenter"));
    expect(commenterOption).toBeTruthy();
    act(() => commenterOption?.click());
    expect(roleTrigger?.textContent).toContain("Commenter");

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "commenter@example.com");
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add",
    );
    if (!add) throw new Error("Add button not found");

    act(() => add.click());

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "commenter@example.com",
        role: "commenter",
      }),
      expect.any(Object),
    );
  });

  it("can omit commenter for resources without comment support", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            allowedRoles={["viewer", "editor", "admin"]}
          />
        </QueryClientProvider>,
      );
    });

    const roleTrigger = container.querySelector(
      'button[aria-label="Role"]',
    ) as HTMLButtonElement | null;
    await act(async () => roleTrigger?.click());
    expect(document.body.textContent).not.toContain(
      "Can view and add comments",
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
      ).some((option) => option.textContent?.includes("Commenter")),
    ).toBe(false);
  });

  it("sends an optional message with the notification", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="deck" resourceId="deck-1" />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "recipient@example.com");

    const addMessage = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add a message",
    );
    if (!addMessage) throw new Error("Add a message button not found");
    act(() => addMessage.click());

    const message = container.querySelector(
      'textarea[aria-label="Message"]',
    ) as HTMLTextAreaElement;
    setInputValue(message, "Here is the latest version.");

    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add",
    );
    if (!add) throw new Error("Add button not found");
    act(() => add.click());

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "recipient@example.com",
        message: "Here is the latest version.",
      }),
      expect.any(Object),
    );
  });

  it("keeps a draft email when the share popover is closed and reopened", async () => {
    popoverTestState.simulateMounting = true;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" defaultOpen />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "recover-me@example.com");

    const openChange = popoverOpenChangeHandlers.at(-1);
    if (!openChange) throw new Error("share popover open handler not found");

    act(() => openChange(false));
    expect(
      container.querySelector('input[placeholder="Add people by email"]'),
    ).toBeNull();

    act(() => openChange(true));
    expect(
      (
        container.querySelector(
          'input[placeholder="Add people by email"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("recover-me@example.com");
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

  it("standardizes legacy icon triggers as text-only", async () => {
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
    expect(trigger?.textContent).toBe("Share");
    expect(trigger?.querySelector("svg")).toBeFalsy();
  });

  it("renders the label trigger as text only regardless of visibility", async () => {
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

    const trigger = container.querySelector(
      'button[aria-label="Share"]',
    ) as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toBe("Share");
    expect(trigger?.querySelector("svg")).toBeFalsy();
    expect(trigger?.querySelector(".animate-pulse")).toBeFalsy();
  });

  it("keeps the standardized trigger usable while sharing data loads", async () => {
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

    expect(trigger?.textContent).toBe("Share");
    expect(trigger?.querySelector("svg")).toBeFalsy();
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

    const text = container.textContent ?? "";
    expect(text).toContain("Editor link");
    expect(text).toContain("Presentation link");
    expect(text).not.toContain("https://slides.agent-native.com");
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent === "Copy",
      ),
    ).toHaveLength(2);
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
    expect(text).toContain("General editing access");
    expect(container.textContent).toContain("People with editing access");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Manage access",
      ),
    ).toBe(false);
    expect(
      (container.textContent ?? "").indexOf("General editing access"),
    ).toBeLessThan(
      (container.textContent ?? "").indexOf("People with editing access"),
    );
  });

  it("renders organization share names without exposing raw org ids", async () => {
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "org",
          principalId: "org-secret-id",
          displayName: "Builder.io",
          role: "editor",
        },
      ],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Builder.io");
    expect(text).not.toContain("org-secret-id");
  });

  it("uses safe labels for unresolved principal ids", async () => {
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "org",
          principalId: "org-secret-id",
          role: "editor",
        },
        {
          id: "share-2",
          principalType: "user",
          principalId: "not-an-email-id",
          role: "viewer",
        },
      ],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Organization");
    expect(text).toContain("Unknown person");
    expect(text).not.toContain("org-secret-id");
    expect(text).not.toContain("not-an-email-id");
  });

  it("does not render a redundant Done button", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareUrl="https://design.agent-native.com/design/design-1"
            shareUrlLabel="Design editor link"
            showShareLinks={false}
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
                {
                  value: "context",
                  label: "Context",
                  content: <div>Context body</div>,
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
    expect(container.textContent).not.toContain("Context");
    expect(container.textContent).not.toContain("Context body");
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

  it("omits the context tab when it is the only custom share tab", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareTabs={{
              tabs: [
                {
                  value: "context",
                  label: "Context",
                  content: <div>Context body</div>,
                },
              ],
            }}
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain("Share deck");
    expect(container.textContent).not.toContain("Context");
    expect(container.textContent).not.toContain("Context body");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
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

  // Keep the non-source-locale provider test last: react-i18next's global
  // fallback instance otherwise leaks the selected language into tests that
  // intentionally exercise providerless compatibility.
  it("localizes the standardized text trigger", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="plan"
              resourceId="plan-1"
              trigger="icon"
            />
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      const trigger = container.querySelector(
        'button[aria-label="Teilen"]',
      ) as HTMLButtonElement | null;
      expect(trigger, container.innerHTML).not.toBeNull();
      expect(trigger?.textContent).toBe("Teilen");
      expect(trigger?.querySelector("svg")).toBeFalsy();
    });
  });
});
