// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ action: string; body: unknown }>,
  copy: vi.fn(async () => true),
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: mocks.copy,
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: vi.fn(),
}));
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => true,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () => false,
  useIsMcpDirectoryWidgetWriteEmbed: () => true,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { DocumentToolbar } from "./DocumentToolbar";

// The calls a write-scoped widget session may make for its own document.
const ALLOWED_ACTIONS = [
  "list-resource-shares",
  "share-resource",
  "unshare-resource",
  "set-resource-visibility",
];

const SHARES = {
  ownerEmail: "owner@example.com",
  orgId: "org-1",
  visibility: "private",
  role: "owner",
  // The app offers an agent link for a readable document; a widget cannot.
  agentReadable: true,
  shares: [
    {
      id: "s1",
      principalType: "user",
      principalId: "bob@example.com",
      role: "viewer",
    },
  ],
  policy: { allowPublic: true, requireOrgMemberForUserShares: false },
};

describe("Share inside an MCP App widget", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let unexpected: string[];

  async function settle() {
    for (let turn = 0; turn < 4; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  function actionNames() {
    return mocks.calls.map((call) => call.action);
  }

  beforeEach(async () => {
    mocks.calls.length = 0;
    unexpected = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        const action = /\/_agent-native\/actions\/([^/?]+)/.exec(
          url.pathname,
        )?.[1];
        if (!action) {
          // The page reads the session and labs for every route, and an
          // avatar lookup falls back to initials when it fails.
          if (
            !url.pathname.includes("/_agent-native/avatar/") &&
            !url.pathname.endsWith("/_agent-native/auth/session")
          ) {
            unexpected.push(url.pathname);
          }
          return new Response("{}", { status: 404 });
        }
        mocks.calls.push({
          action,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        // The scoped session refuses everything but the share actions.
        const status = ALLOWED_ACTIONS.includes(action) ? 200 : 403;
        const body = action === "list-resource-shares" ? SHARES : {};
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 1040, height: 48 }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(DocumentToolbar, {
                documentId: "widget-fixture",
                documentTitle: "Roadmap",
                utilityPanel: null,
                onUtilityPanelChange: vi.fn(),
                readOnly: true,
                canEdit: true,
              }),
            ),
          ),
        ),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function shareTrigger() {
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.toolbar.share"], button[aria-label="agentChat.share.share"]',
    );
  }

  async function openShare() {
    await act(async () => shareTrigger()!.click());
    await settle();
  }

  it("requests nothing until Share is pressed, then only the share actions", async () => {
    await settle();
    expect(actionNames().filter((name) => name !== "get-lab-states")).toEqual(
      [],
    );

    await openShare();

    expect(document.body.textContent).toContain("bob@example.com");
    expect(actionNames().filter((name) => name !== "get-lab-states")).toSatisfy(
      (names: string[]) =>
        names.length > 0 &&
        names.every((name) => name === "list-resource-shares"),
    );
    expect(unexpected).toEqual([]);
    // No Agents tab, Context tab, search toggle, access requests, or agent link.
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "agentChat.share.shareWithAgents",
    );
    expect(document.body.textContent).not.toContain(
      "agentChat.share.accessRequests",
    );
    expect(document.body.textContent).not.toContain(
      "editor.toolbar.hideInSearch",
    );
  });

  it("adds a typed email and removes a person without asking for suggestions", async () => {
    await openShare();
    const input = document.body.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    expect(input).not.toBeNull();

    await act(async () => input!.focus());
    await settle();
    // Typing opens no suggestion list and searches no one.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input!, "dana@example.com");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.textContent).not.toContain(
      "agentChat.share.loadPeopleFailed",
    );

    const add = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "agentChat.share.add",
    );
    await act(async () => add!.click());
    await settle();
    const added = mocks.calls.find((call) => call.action === "share-resource");
    expect(added?.body).toMatchObject({
      resourceType: "document",
      resourceId: "widget-fixture",
      principalType: "user",
      principalId: "dana@example.com",
    });

    const remove = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="agentChat.share.remove"]',
    );
    await act(async () => remove!.click());
    await settle();
    const removed = mocks.calls.find(
      (call) => call.action === "unshare-resource",
    );
    expect(removed?.body).toMatchObject({
      resourceType: "document",
      resourceId: "widget-fixture",
      principalType: "user",
      principalId: "bob@example.com",
    });

    const refused = actionNames().filter(
      (name) => !ALLOWED_ACTIONS.includes(name) && name !== "get-lab-states",
    );
    expect(refused).toEqual([]);
    expect(unexpected).toEqual([]);
  });

  it("copies the page link from the joined control", async () => {
    await openShare();
    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editor.toolbar.copyPageLink"]',
    );
    await act(async () => copy!.click());

    expect(mocks.copy).toHaveBeenCalledOnce();
    expect(mocks.copy.mock.calls[0]).toEqual([
      expect.stringContaining("/p/widget-fixture"),
    ]);
  });
});
