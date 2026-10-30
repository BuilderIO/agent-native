import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { ShareButton, type ShareButtonActionHandle } from "./ShareButton.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

const shareMutate = vi.hoisted(() => vi.fn());
const unshareMutate = vi.hoisted(() => vi.fn());
const agentLinkMutate = vi.hoisted(() => vi.fn());
const otherMutate = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
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
const sheetInteractOutsideHandlers = vi.hoisted(
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
const sharesError = vi.hoisted(() => ({ current: false }));
const sharesData = vi.hoisted(() => ({
  current: {
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    role: "owner",
    shares: [],
  },
}));

const accessRequestsData = vi.hoisted(() => ({
  current: [] as unknown[],
  hasMore: false,
  isError: false,
}));
const refetchRequests = vi.hoisted(() => vi.fn(async () => undefined));
const approveRequest = vi.hoisted(() => vi.fn());
const queriedActions = vi.hoisted(() => [] as string[]);

vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: (name: string) => {
    queriedActions.push(name);
    return name === "list-resource-access-requests"
      ? {
          data: {
            requests: accessRequestsData.current,
            hasMore: accessRequestsData.hasMore,
          },
          isError: accessRequestsData.isError,
          refetch: refetchRequests,
        }
      : {
          data: sharesData.current,
          isError: sharesError.current,
          refetch: refetchShares,
        };
  },
  useActionMutation: (name: string) => ({
    mutate:
      name === "share-resource"
        ? shareMutate
        : name === "unshare-resource"
          ? unshareMutate
          : name === "create-agent-resource-link"
            ? agentLinkMutate
            : otherMutate,
    mutateAsync:
      name === "approve-resource-access-request" ? approveRequest : otherMutate,
  }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@agent-native/toolkit/ui/popover", () => {
  const PopoverOpenContext = React.createContext(true);
  const isOuterSharePopover = (node: React.ReactNode): boolean =>
    React.Children.toArray(node).some((child) => {
      if (!React.isValidElement(child)) return false;
      const props = child.props as { children?: React.ReactNode } & Record<
        string,
        unknown
      >;
      return String(props.className ?? "").includes("w-[384px]");
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

vi.mock("@agent-native/toolkit/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({
    children,
    onInteractOutside,
  }: {
    children: React.ReactNode;
    onInteractOutside?: (event: {
      detail: { originalEvent: { target: EventTarget | null } };
      preventDefault: () => void;
    }) => void;
  }) => {
    if (onInteractOutside) sheetInteractOutsideHandlers.push(onInteractOutside);
    return <div>{children}</div>;
  },
}));

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

// Radix tabs activate on mousedown, like a real pointer press.
function pressTab(tab: HTMLElement) {
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
}

function buttonWithText(
  scope: ParentNode,
  text: string,
): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function inviteButton(scope: ParentNode): HTMLButtonElement {
  const invite = buttonWithText(scope, "Invite");
  if (!invite) throw new Error("Invite button not found");
  return invite;
}

// Radix dropdown menus open on a primary-button pointerdown.
async function openSendTo(scope: ParentNode) {
  const trigger = buttonWithText(scope, "Send to");
  if (!trigger) throw new Error("Send to button not found");
  await act(async () => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    await Promise.resolve();
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
}

function menuItem(label: string): HTMLElement {
  const item = menuItems().find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!item) throw new Error(`${label} menu item not found`);
  return item;
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
    unshareMutate.mockReset();
    agentLinkMutate.mockReset();
    otherMutate.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    approveRequest.mockReset().mockResolvedValue(undefined);
    accessRequestsData.current = [];
    accessRequestsData.hasMore = false;
    accessRequestsData.isError = false;
    refetchRequests.mockClear();
    queriedActions.length = 0;
    refetchShares.mockClear();
    popoverInteractOutsideHandlers.length = 0;
    sheetInteractOutsideHandlers.length = 0;
    popoverOpenChangeHandlers.length = 0;
    popoverTestState.simulateMounting = false;
    sharesError.current = false;
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

  it("submits one typed email with Invite while keeping the share popover open", async () => {
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

    const invite = inviteButton(container);
    act(() => {
      invite.click();
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
    expect(roleTrigger?.textContent).toContain("Can view");
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
    const invite = inviteButton(container);
    act(() => invite.click());

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
      ).some((option) => option.textContent?.includes("Can comment")),
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

    const invite = inviteButton(container);
    act(() => invite.click());

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "recipient@example.com",
        message: "Here is the latest version.",
      }),
      expect.any(Object),
    );
  });

  it("keeps the invite row compact with the role inside the field and a text Invite button", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Add people by email"]',
    );
    const field = input?.parentElement;
    const role = container.querySelector('button[aria-label="Role"]');
    const invite = inviteButton(container);
    expect(field?.contains(role ?? null)).toBe(true);
    expect(field?.contains(invite)).toBe(false);
    expect(invite.textContent).toBe("Invite");
    expect(invite.querySelector("svg")).toBeNull();
    expect(invite.disabled).toBe(true);

    setInputValue(input!, "someone@example.com");
    expect(invite.disabled).toBe(false);
  });

  it("renders the compact 384px popover and lets a host raise its layer", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            popoverClassName="z-[100010]"
          />
        </QueryClientProvider>,
      );
    });

    const popover = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-agent-native-share-overlay]",
      ),
    ).find((node) => node.className.includes("w-[384px]"));
    expect(popover).toBeDefined();
    expect(popover?.className).toContain("z-[100010]");
    expect(popover?.className).not.toContain("z-[2000]");
    expect(popover?.className).not.toContain("460px");
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

  it("opens without a trigger when invoked from an external menu", async () => {
    popoverTestState.simulateMounting = true;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            defaultOpen
            hideTrigger
          />
        </QueryClientProvider>,
      );
    });

    expect(container.querySelector('button[aria-label="Share"]')).toBeNull();
    expect(
      container.querySelector("[data-agent-native-share-overlay]"),
    ).not.toBeNull();
  });

  it("shows the copy action for share URLs regardless of visibility", async () => {
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

    expect(buttonWithText(container, "Copy link")).toBeDefined();
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

    const copy = buttonWithText(container, "Copy link");
    if (!copy) throw new Error("Copy link button not found");

    await act(async () => {
      copy.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(shareUrl);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copy.textContent).toBe("Copied");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("says the link was not copied when every clipboard path is denied", async () => {
    const shareUrl = "https://slides.agent-native.com/deck/deck-1";
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    const execCommand = vi.fn(() => false);
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

    const copy = buttonWithText(container, "Copy link");
    if (!copy) throw new Error("Copy link button not found");

    await act(async () => {
      copy.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(shareUrl);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't copy the link.");
    expect(copy.textContent).toBe("Copy link");
  });

  it("shows the placeholder instead of Copy link while the resource has no link", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrlPlaceholder="Publish to get a link"
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("Publish to get a link");
    expect(buttonWithText(container, "Copy link")).toBeUndefined();
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

  it("allows an explicit compact trigger while preserving the Share label", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="chat_thread"
            resourceId="thread-1"
            triggerContent={<span data-share-icon="">↗</span>}
          />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector(
      'button[aria-label="Share"]',
    ) as HTMLButtonElement | null;

    expect(trigger?.querySelector("[data-share-icon]")).not.toBeNull();
    expect(trigger?.getAttribute("title")).toBe("Share");
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

  it("reports a failed shares read instead of skeletoning forever", async () => {
    sharesData.current = undefined as any;
    sharesError.current = true;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="plan"
            resourceId="plan-1"
            shareUrl="https://plan.agent-native.com/plans/plan-1"
          />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("Couldn't load sharing settings.");
    expect(container.querySelector(".animate-pulse")).toBeFalsy();

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    if (!retry) throw new Error("Retry button not found");
    const refetchesBefore = refetchShares.mock.calls.length;
    act(() => {
      retry.click();
    });

    expect(refetchShares.mock.calls.length).toBe(refetchesBefore + 1);
  });

  it("renders one Copy link button labeled for its link without printing the URL", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            shareUrl="https://slides.agent-native.com/deck/deck-1"
            shareUrlLabel="Editor link"
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("https://slides.agent-native.com");
    const copyButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent === "Copy link");
    expect(copyButtons).toHaveLength(1);
    expect(copyButtons[0].getAttribute("title")).toBe("Editor link");
  });

  it("prepares the agent link only when the Send to menu opens, then copies it", async () => {
    sharesData.current = {
      ...sharesData.current,
      agentReadable: true,
    };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="deck" resourceId="deck-1" />
        </QueryClientProvider>,
      );
    });

    expect(agentLinkMutate).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Copy agent link");

    await openSendTo(container);

    expect(agentLinkMutate).toHaveBeenCalledOnce();
    expect(agentLinkMutate).toHaveBeenCalledWith(
      { resourceType: "deck", resourceId: "deck-1" },
      expect.any(Object),
    );
    expect(menuItem("Preparing agent link...")).toBeDefined();

    const [, callbacks] = agentLinkMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (result: { contextUrl?: string }) => void },
    ];
    act(() =>
      callbacks.onSuccess({
        contextUrl: "https://slides.agent-native.com/agent/deck-1",
      }),
    );

    await act(async () => {
      menuItem("Copy agent link").click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      "https://slides.agent-native.com/agent/deck-1",
    );
    expect(toastMock.success).toHaveBeenCalledWith("Copied agent link");
    expect(agentLinkMutate).toHaveBeenCalledOnce();
  });

  it("offers no Send to menu for a resource agents cannot read and no destinations", async () => {
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

    expect(buttonWithText(container, "Copy link")).toBeDefined();
    expect(buttonWithText(container, "Send to")).toBeUndefined();
    expect(agentLinkMutate).not.toHaveBeenCalled();
  });

  it("lists the app's Send to destinations in order and runs the chosen one", async () => {
    const openInAgent = vi.fn();
    const exportPdf = vi.fn();
    const copyAgentPrompt = vi.fn();
    const openMcpSettings = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            sendTo={{
              openInAgent,
              items: [
                { id: "pdf", label: "Export PDF", onSelect: exportPdf },
                {
                  id: "slack",
                  label: "Post to Slack",
                  onSelect: vi.fn(),
                  disabled: true,
                },
              ],
              copyAgentPrompt,
              openMcpSettings,
            }}
          />
        </QueryClientProvider>,
      );
    });

    await openSendTo(container);

    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      "Open in Claude",
      "Open in Claude Code",
      "Open in Codex",
      "Export PDF",
      "Post to Slack",
      "Copy agent prompt",
      "MCP server settings",
    ]);
    expect(menuItem("Post to Slack").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(agentLinkMutate).not.toHaveBeenCalled();

    act(() => menuItem("Open in Claude Code").click());
    expect(openInAgent).toHaveBeenCalledWith("claude-code");

    await openSendTo(container);
    act(() => menuItem("Export PDF").click());
    expect(exportPdf).toHaveBeenCalledOnce();

    await openSendTo(container);
    act(() => menuItem("Copy agent prompt").click());
    expect(copyAgentPrompt).toHaveBeenCalledOnce();

    await openSendTo(container);
    act(() => menuItem("MCP server settings").click());
    expect(openMcpSettings).toHaveBeenCalledOnce();
  });

  it("builds the agent prompt from the type's read tool", async () => {
    const shareUrl = "https://analytics.agent-native.com/dashboards/dash-1";
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const withAgentRead = {
      ...sharesData.current,
      agentRead: {
        actions: ["get-sql-dashboard", "get-explorer-dashboard"],
        idParam: "id",
        label: "Analytics dashboard",
      },
    };
    sharesData.current = withAgentRead;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="dashboard"
            resourceId="dash-1"
            shareUrl={shareUrl}
          />
        </QueryClientProvider>,
      );
    });

    await openSendTo(container);
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      "Open in Claude",
      "Open in Claude Code",
      "Open in Codex",
      "Copy agent prompt",
    ]);

    await act(async () => {
      menuItem("Copy agent prompt").click();
      await Promise.resolve();
    });

    const prompt = writeText.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain(`Read this Analytics dashboard: ${shareUrl}`);
    expect(prompt).toContain(
      `MCP connection for ${window.location.origin}/mcp to call get-sql-dashboard or get-explorer-dashboard with id "dash-1"`,
    );
    expect(prompt).toContain(`${window.location.origin}/mcp/connect`);
    expect(toastMock.success).toHaveBeenCalledWith("Copied agent prompt");
  });

  it("keeps an app's own agent destinations over the type's read tool", async () => {
    const openInAgent = vi.fn();
    const withAgentRead = {
      ...sharesData.current,
      agentRead: { actions: ["get-document"], idParam: "id", label: "doc" },
    };
    sharesData.current = withAgentRead;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="document"
            resourceId="doc-1"
            sendTo={{ openInAgent }}
          />
        </QueryClientProvider>,
      );
    });

    await openSendTo(container);
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual([
      "Open in Claude",
      "Open in Claude Code",
      "Open in Codex",
    ]);
    act(() => menuItem("Open in Codex").click());
    expect(openInAgent).toHaveBeenCalledWith("codex");
  });

  it("offers no agent prompt to a session limited to the basic share actions", async () => {
    const withAgentRead = {
      ...sharesData.current,
      agentRead: { actions: ["get-deck"], idParam: "id", label: "deck" },
    };
    sharesData.current = withAgentRead;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            basicSharingOnly
          />
        </QueryClientProvider>,
      );
    });

    expect(buttonWithText(container, "Send to")).toBeUndefined();
  });

  it("can customize access labels", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="form"
            resourceId="form-1"
            shareUrl="https://forms.agent-native.com/f/form-1"
            shareUrlLabel="Public response link"
            peopleAccessLabel="People with editing access"
            generalAccessLabel="General editing access"
          />
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("General editing access");
    expect(text).toContain("People with editing access");
    expect(text).not.toContain("People with access");
    expect(text).not.toContain("General access");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Manage access",
      ),
    ).toBe(false);
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

  it("marks an agent row with an Agent badge and no email subline", async () => {
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "user",
          principalId: "dana@example.com",
          displayName: "Dana Example",
          role: "editor",
        },
        {
          id: "share-2",
          principalType: "user",
          principalId: "research-agent@agents.example.test",
          displayName: "Research agent",
          agent: true,
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

    const rows = Array.from(container.querySelectorAll<HTMLElement>("li"));
    const person = rows.find((row) =>
      row.textContent?.includes("Dana Example"),
    );
    const agent = rows.find((row) =>
      row.textContent?.includes("Research agent"),
    );
    if (!person || !agent) throw new Error("share rows not found");

    expect(person.textContent).toContain("dana@example.com");
    expect(
      Array.from(person.querySelectorAll("div")).some(
        (node) => node.textContent === "Agent",
      ),
    ).toBe(false);

    expect(
      Array.from(agent.querySelectorAll("div")).some(
        (node) => node.textContent === "Agent",
      ),
    ).toBe(true);
    expect(agent.textContent).not.toContain(
      "research-agent@agents.example.test",
    );
  });

  it("invites an agent picked from the suggestions without notifying it", async () => {
    sharesData.current = {
      ...sharesData.current,
      orgId: "org-1",
      agents: [
        { email: "research-agent@agents.example.test", name: "Research agent" },
      ],
    } as typeof sharesData.current;

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people or agents"]',
    ) as HTMLInputElement;
    if (!input) throw new Error("invite input not found");
    setInputValue(input, "research");

    const suggestion = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Research agent"));
    if (!suggestion) throw new Error("agent suggestion not found");
    expect(suggestion.textContent).toContain("Agent");
    act(() => suggestion.click());

    expect(input.value).toBe("Research agent");
    expect(container.textContent).not.toContain("Notify people");

    act(() => inviteButton(container).click());

    expect(shareMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: "user",
        principalId: "research-agent@agents.example.test",
        notify: false,
      }),
      expect.any(Object),
    );
    expect(shareMutate.mock.calls[0][0]).not.toHaveProperty("message");
  });

  it("removes access from a row's role menu", async () => {
    sharesData.current = {
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      shares: [
        {
          id: "share-1",
          principalType: "user",
          principalId: "dana@example.com",
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

    const row = Array.from(container.querySelectorAll<HTMLElement>("li")).find(
      (candidate) => candidate.textContent?.includes("dana@example.com"),
    );
    if (!row) throw new Error("share row not found");
    const rowRole = row.querySelector<HTMLButtonElement>(
      'button[aria-label="Role"]',
    );
    expect(Array.from(row.querySelectorAll("button"))).toEqual([rowRole]);
    expect(rowRole?.textContent).toContain("Can edit");
    await act(async () => rowRole?.click());
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.at(-1)?.textContent).toBe("Remove access");
    act(() => options.at(-1)?.click());

    expect(unshareMutate).toHaveBeenCalledWith(
      {
        resourceType: "document",
        resourceId: "doc-1",
        principalType: "user",
        principalId: "dana@example.com",
      },
      expect.any(Object),
    );
    expect(shareMutate).not.toHaveBeenCalled();
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

  it("keeps the mobile share sheet open for nested portaled share menus", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton resourceType="document" resourceId="doc-1" mobileSheet />
        </QueryClientProvider>,
      );
    });

    const handler =
      sheetInteractOutsideHandlers[sheetInteractOutsideHandlers.length - 1];
    if (!handler) throw new Error("share sheet outside handler not found");

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
    const actionRef = React.createRef<ShareButtonActionHandle>();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareUrl="https://design.agent-native.com/design/design-1"
            actionRef={actionRef}
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

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Share link",
      "Export",
      "Send to...",
      "Context",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
    ).toBe("Share options");
    expect(container.textContent).not.toContain("Context body");
    expect(container.textContent).not.toContain("Export body");
    expect(
      container
        .querySelector('[role="tabpanel"]')
        ?.getAttribute("aria-labelledby"),
    ).toBe(tabs[0].id);

    act(() => actionRef.current?.open("export"));

    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Export body");
    expect(container.textContent).not.toContain("Send body");
    expect(container.textContent).not.toContain("Add people by email");
  });

  it("draws every share tab, including app-owned ones, as an underline tab", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="design"
            resourceId="design-1"
            shareTabs={{
              tabs: [
                {
                  value: "export",
                  label: "Export",
                  content: <div>Export body</div>,
                },
              ],
            }}
          />
        </QueryClientProvider>,
      );
    });

    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    expect(list?.className).toContain("bg-transparent");
    expect(list?.className).not.toContain("bg-muted");
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.className).toContain("after:h-0.5");
      expect(tab.className).toContain("data-[state=active]:bg-transparent");
      expect(tab.className).not.toContain("shadow-sm");
    }
  });

  it("renders the context tab when it is the only custom share tab", async () => {
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

    expect(container.textContent).toContain("Share link");
    expect(container.textContent).toContain("Context");
    expect(container.textContent).not.toContain("Context body");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();

    const contextTab = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "Context");
    if (!contextTab) throw new Error("Context tab not found");

    pressTab(contextTab);

    expect(container.textContent).toContain("Context body");
    const contextPanelId = contextTab.getAttribute("aria-controls");
    expect(contextPanelId).toBeTruthy();
    const contextPanel = contextPanelId
      ? document.getElementById(contextPanelId)
      : null;
    expect(contextPanel?.getAttribute("aria-labelledby")).toBe(
      contextTab.getAttribute("id"),
    );
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
          members: [
            {
              email: "akash@builder.io",
              image: "https://lh3.googleusercontent.com/a/avatar.jpg",
              name: "Akash",
              role: "member",
            },
          ],
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
    expect(
      container.querySelector(
        'img[src="https://lh3.googleusercontent.com/a/avatar.jpg"]',
      ),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/_agent-native/avatar/"),
      ),
    ).toBe(false);

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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/_agent-native/org/members")) {
        return Promise.resolve(
          url.includes("offset=25")
            ? Response.json({
                members: [{ email: "second@builder.io", role: "member" }],
                hasMore: false,
                nextOffset: null,
              })
            : Response.json({
                members: [{ email: "first@builder.io", role: "member" }],
                hasMore: true,
                nextOffset: 25,
              }),
        );
      }
      return Promise.resolve(Response.json({ image: null }));
    });
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

    const loadMoreCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("offset=25"),
    );
    expect(String(loadMoreCall?.[0])).toContain("offset=25");
    expect(container.textContent).toContain("second@builder.io");
  });

  it("keeps Copy link and Send to in one footer after the people and access sections", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="deck"
              resourceId="deck-1"
              defaultOpen
              shareUrl="https://slides.agent-native.com/deck/deck-1"
              sendTo={{ copyAgentPrompt: vi.fn() }}
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    const copy = buttonWithText(container, "Copy link");
    const sendTo = buttonWithText(container, "Send to");
    if (!copy || !sendTo) throw new Error("share footer actions not found");
    const footer = copy.parentElement!;
    expect(footer.contains(sendTo)).toBe(true);

    const sections = Array.from(
      footer.parentElement!.querySelectorAll<HTMLElement>(":scope > section"),
    );
    expect(sections.map((section) => section.firstChild?.textContent)).toEqual([
      "People with access",
      "General access",
    ]);
    for (const section of sections) {
      expect(
        section.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("keeps quick copy separate from the popover's Copy link", async () => {
    const shareUrl = "https://content.agent-native.com/page/doc-1";
    const onCopy = vi.fn(async () => true);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="document"
              resourceId="doc-1"
              shareUrl={shareUrl}
              quickCopy={{
                label: "Copy page link",
                copiedLabel: "Copied page link",
                onCopy,
              }}
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    const quickCopy = container.querySelector(
      'button[aria-label="Copy page link"]',
    ) as HTMLButtonElement;
    expect(quickCopy).not.toBeNull();
    await act(async () => quickCopy.click());
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();

    const copyLink = buttonWithText(container, "Copy link");
    if (!copyLink) throw new Error("Copy link button not found");
    expect(copyLink.contains(quickCopy)).toBe(false);
    expect(quickCopy.contains(copyLink)).toBe(false);
    await act(async () => {
      copyLink.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(shareUrl);
    expect(copyLink.textContent).toBe("Copied");
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  const patRequest = {
    id: "req-1",
    generation: 3,
    state: "pending",
    requester: { email: "requester@example.test", name: "Pat Example" },
    note: "Need this for the launch review.",
    requestedAt: "2026-10-01T10:00:00.000Z",
    decidedAt: null,
    grantedRole: null,
    resource: {
      type: "document",
      id: "doc-1",
      label: "Document",
      title: "Launch plan",
      path: "/page/doc-1",
    },
  };

  async function renderWithRequests() {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="document"
              resourceId="doc-1"
              peopleAccessLabel="Who has access"
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });
  }

  async function allowPat() {
    const allow = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Allow Pat Example"]',
    );
    await act(async () => allow!.click());
  }

  it("lists access requests above who has access, and Allow grants Viewer", async () => {
    accessRequestsData.current = [patRequest];
    await renderWithRequests();

    const text = container.textContent ?? "";
    expect(text).toContain("Need this for the launch review.");
    expect(text.indexOf("Access requests")).toBeGreaterThan(-1);
    expect(text.indexOf("Access requests")).toBeLessThan(
      text.indexOf("Who has access"),
    );

    await allowPat();
    expect(approveRequest).toHaveBeenCalledWith({
      requestId: "req-1",
      generation: 3,
      role: "viewer",
    });
  });

  it("reloads the requests when someone else already handled one", async () => {
    accessRequestsData.current = [patRequest];
    approveRequest.mockRejectedValueOnce(
      Object.assign(new Error("stale"), {
        status: 409,
        errorCode: "access_request_stale",
      }),
    );
    await renderWithRequests();

    await allowPat();

    expect(refetchRequests).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Someone already handled this request, or it changed.",
    );
  });

  it("says when the requester couldn't be emailed that they're in", async () => {
    accessRequestsData.current = [patRequest];
    approveRequest.mockResolvedValueOnce({
      state: "approved",
      role: "viewer",
      email: "failed",
    });
    await renderWithRequests();

    await allowPat();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Pat Example has access, but we couldn't email them.",
    );
  });

  it("keeps saying the email failed when the list can't reload", async () => {
    accessRequestsData.current = [patRequest];
    approveRequest.mockImplementationOnce(async () => {
      accessRequestsData.isError = true;
      return { state: "approved", role: "viewer", email: "failed" };
    });
    await renderWithRequests();

    await allowPat();

    expect(container.textContent).toContain("Couldn't load access requests.");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Pat Example has access, but we couldn't email them.",
    );
  });

  it("says when older requests are past the list", async () => {
    accessRequestsData.current = [patRequest];
    accessRequestsData.hasMore = true;
    await renderWithRequests();

    expect(container.textContent).toContain("Showing the 1 newest requests.");
  });

  it("doesn't read access requests for someone who can't manage access", async () => {
    sharesData.current = { ...sharesData.current, role: "viewer" };
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton resourceType="document" resourceId="doc-1" />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    expect(container.textContent).toContain("People with access");
    expect(queriedActions).not.toContain("list-resource-access-requests");
  });

  it("keeps to the basic share actions when the session cannot run the rest", async () => {
    sharesData.current = { ...sharesData.current, agentReadable: true };
    accessRequestsData.current = [patRequest];
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="deck"
              resourceId="deck-1"
              basicSharingOnly
              sendTo={{ copyAgentPrompt: vi.fn() }}
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("People with access");
    expect(text).not.toContain("Access requests");
    expect(buttonWithText(container, "Send to")).toBeUndefined();
    expect(agentLinkMutate).not.toHaveBeenCalled();
    expect(queriedActions).not.toContain("list-resource-access-requests");
    expect(queriedActions).toContain("list-resource-shares");
  });

  it("does not search the organization for people when keeping to the basic share actions", async () => {
    const fetchMock = vi.fn(async () => Response.json({ members: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="deck"
              resourceId="deck-1"
              basicSharingOnly
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    act(() => input.focus());
    setInputValue(input, "guest@example.com");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("/_agent-native/org/members"),
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain("Could not load people.");
  });

  it("does not offer the admin role or an email note when keeping to the basic share actions", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ShareButton
            resourceType="deck"
            resourceId="deck-1"
            basicSharingOnly
          />
        </QueryClientProvider>,
      );
    });

    const input = container.querySelector(
      'input[placeholder="Add people by email"]',
    ) as HTMLInputElement;
    setInputValue(input, "guest@example.com");
    expect(container.textContent).toContain("Notify people");
    expect(container.textContent).not.toContain("Add a message");

    const roleTrigger = container.querySelector(
      'button[aria-label="Role"]',
    ) as HTMLButtonElement | null;
    await act(async () => roleTrigger?.click());
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).map((option) => option.textContent ?? "");
    expect(options.some((option) => option.includes("Can edit"))).toBe(true);
    expect(options.some((option) => option.includes("Can manage access"))).toBe(
      false,
    );
  });

  it("offers the admin role and an email note outside the basic share actions", async () => {
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
    setInputValue(input, "guest@example.com");
    expect(container.textContent).toContain("Add a message");

    const roleTrigger = container.querySelector(
      'button[aria-label="Role"]',
    ) as HTMLButtonElement | null;
    await act(async () => roleTrigger?.click());
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
      ).some((option) => option.textContent?.includes("Can manage access")),
    ).toBe(true);
  });

  it("lets a host size the joined copy control through quickCopy.className", async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ShareButton
              resourceType="document"
              resourceId="doc-1"
              quickCopy={{
                label: "Copy page link",
                copiedLabel: "Copied page link",
                onCopy: async () => true,
                className: "widget-joined-share",
              }}
            />
          </QueryClientProvider>
        </TooltipProvider>,
      );
    });

    const joined = container.querySelector(".widget-joined-share");
    expect(joined).not.toBeNull();
    expect(
      joined?.contains(
        container.querySelector('button[aria-label="Copy page link"]'),
      ),
    ).toBe(true);
    expect(
      joined?.contains(container.querySelector('button[aria-label="Share"]')),
    ).toBe(true);
  });

  // Keep the non-source-locale provider test last: react-i18next's global
  // fallback instance otherwise leaks the selected language into tests that
  // intentionally exercise providerless compatibility.
  it("localizes the standardized text trigger", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
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
