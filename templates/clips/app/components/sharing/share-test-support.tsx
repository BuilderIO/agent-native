import type { ShareButtonSharesResponse } from "@agent-native/core/client/sharing/useShareButtonController";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  data: undefined as ShareButtonSharesResponse | undefined,
  query: vi.fn(),
  refetch: vi.fn(async () => undefined),
  visibility: vi.fn(),
  share: vi.fn(),
  unshare: vi.fn(),
  update: vi.fn(),
  createLink: vi.fn(async () => ({
    contextUrl: "https://clips.example.test/scoped-agent",
  })),
  clipboard: vi.fn(async (_value: string) => true),
  track: vi.fn(),
}));
function mutation(name: string) {
  if (name === "set-resource-visibility")
    return { mutateAsync: mocks.visibility };
  if (name === "share-resource") return { mutate: mocks.share };
  if (name === "unshare-resource") return { mutate: mocks.unshare };
  if (name.includes("agent-link") || name === "create-agent-resource-link")
    return { mutateAsync: mocks.createLink };
  return { mutate: mocks.update };
}
vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: (...args: unknown[]) => {
    mocks.query(...args);
    return { data: mocks.data, refetch: mocks.refetch, isLoading: false };
  },
  useActionMutation: (name: string) => mutation(name),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string) => mutation(name),
  useSession: () => ({ session: { userId: "test-owner" } }),
}));
vi.mock("@agent-native/core/client/org/hooks", () => ({
  useOrg: () => ({ data: null }),
}));
vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: mocks.track,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
}));
vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.clipboard,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverAnchor: ({ children }: { children: ReactNode }) => children,
}));

export function shareTestHarness() {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ members: [] }) })),
    );
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    mocks.data = {
      ownerEmail: "owner@example.test",
      orgId: "org-test",
      role: "owner",
      visibility: "private",
      shares: [
        {
          id: "share-test",
          principalType: "user",
          principalId: "viewer@example.test",
          role: "viewer",
        },
      ],
    };
    mocks.visibility
      .mockReset()
      .mockImplementation(async ({ visibility }: { visibility: string }) => ({
        visibility,
      }));
    mocks.clipboard.mockResolvedValue(true);
    client = new QueryClient({
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
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  });
  return {
    async render(children: ReactNode) {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <TooltipProvider>{children}</TooltipProvider>
          </QueryClientProvider>,
        ),
      );
    },
    get client() {
      return client;
    },
  };
}
export function button(label: string, scope: ParentNode = document.body) {
  const result = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (el) =>
      el.textContent?.trim() === label ||
      el.getAttribute("aria-label") === label,
  );
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}
export async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    element.click();
  });
}
export async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
export async function select(trigger: HTMLElement, label: string) {
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((el) => el.textContent?.includes(label));
  expect(option, `option ${label}`).toBeDefined();
  await click(option!);
}

export { mocks };
