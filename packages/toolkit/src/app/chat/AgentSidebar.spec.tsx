// @vitest-environment happy-dom

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import React, { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_CHAT_INSERT_REFERENCE_EVENT } from "../../composer/runtime-adapters.js";
import { TiptapComposer } from "../../composer/TiptapComposer.js";
import { TooltipProvider } from "../../ui/tooltip.js";

const mockTrust = vi.hoisted(() => ({ frame: true, builder: false }));

const mockHostedHarness = vi.hoisted(() => ({
  configured: false,
  enabled: false,
}));

const mockPanel = vi.hoisted(() => {
  let resolveImport!: () => void;
  return {
    imports: 0,
    events: [] as Array<{ type: string; detail: unknown }>,
    composer: undefined as React.ReactNode,
    importGate: new Promise<void>((resolve) => {
      resolveImport = resolve;
    }),
    resolveImport: () => resolveImport(),
  };
});

vi.mock("./AgentSidebarPanel.js", async () => {
  mockPanel.imports++;
  await mockPanel.importGate;
  return {
    AgentSidebarPanel: ({
      onReadyChange,
    }: {
      onReadyChange?: (ready: boolean) => void;
    }) => {
      React.useEffect(() => {
        const record = (event: Event) =>
          mockPanel.events.push({
            type: event.type,
            detail:
              event instanceof MessageEvent
                ? event.data
                : (event as CustomEvent).detail,
          });
        window.addEventListener("agent-panel:set-mode", record);
        window.addEventListener("agent-panel:open-settings", record);
        window.addEventListener("agent-chat:open-thread", record);
        window.addEventListener("message", record);
        window.addEventListener(AGENT_CHAT_INSERT_REFERENCE_EVENT, record);
        onReadyChange?.(true);
        return () => {
          onReadyChange?.(false);
          window.removeEventListener("agent-panel:set-mode", record);
          window.removeEventListener("agent-panel:open-settings", record);
          window.removeEventListener("agent-chat:open-thread", record);
          window.removeEventListener("message", record);
          window.removeEventListener(AGENT_CHAT_INSERT_REFERENCE_EVENT, record);
        };
      }, [onReadyChange]);
      return (
        <div data-agent-sidebar-panel-loaded="true">
          {mockPanel.composer ?? <textarea aria-label="Chat composer" />}
        </div>
      );
    },
  };
});
vi.mock("./agent-sidebar-url-sync.js", () => ({
  ScreenRefreshBoundary: ({
    children,
    active,
  }: {
    children: React.ReactNode;
    active?: boolean;
  }) => (
    <div data-testid="screen-refresh-boundary" data-active={active ?? true}>
      {children}
    </div>
  ),
  SettingsReturnPathRecorder: () => null,
  URLSync: () => <div data-testid="agent-sidebar-url-sync" />,
}));
vi.mock("@agent-native/core/client/mcp-app-host", () => ({}));
vi.mock("@agent-native/core/client/app-config", () => ({
  injectedAgentNativeConfig: () => ({
    harness: mockHostedHarness.configured ? {} : undefined,
  }),
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/host")>();
  return {
    ...actual,
    getFramePostMessageTargetOrigin: () => null,
    isTrustedFrameMessage: () => mockTrust.frame,
    isTrustedBuilderMessage: () => mockTrust.builder,
    shouldParentFrameOwnAgentPanel: () => false,
  };
});
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    AGENT_CHAT_VIEW_TRANSITION_CLASS: "",
    getAgentChatViewTransitionStyle: (style: React.CSSProperties) => style,
    startAgentChatViewTransition: () => undefined,
  };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/onboarding", () => ({
  isFirstRunOnboardingEnabled: () => false,
  useFirstRunOnboardingGateOwnsSurface: () => false,
  useOnboardingPreviewMode: () => false,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    APP_CHAT_SIDEBAR_STATE_EVENT: "app-chat-sidebar-state",
    APP_CHAT_SIDEBAR_STATE_REQUEST_MESSAGE: "app-chat-sidebar-state-request",
    buildAppChatSidebarStateMessage: (open: boolean) => ({
      data: { open },
    }),
    isPerAppChatStorageKey: () => false,
    requestPerAppChatCommand: vi.fn(),
    useActionQuery: (action: string) => ({
      data:
        action === "get-hosted-harness-config" && mockHostedHarness.enabled
          ? { enabled: true, runtimes: [] }
          : undefined,
    }),
    usePerAppChatState: () => ({ hosted: false, open: false }),
    useScreenRefreshKey: () => 0,
  };
});

import { AgentSidebar, preloadAgentChatSurface } from "./AgentSidebar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderSidebar(
  defaultOpen: boolean,
  position?: "left" | "right",
  disableChatShortcut = false,
  enabled = true,
  screenRefreshEnabled = true,
  forceOverlay = false,
  openOnChatRunning = false,
) {
  const render = (nextEnabled: boolean) => {
    flushSync(() => {
      root?.render(
        <MemoryRouter>
          <AgentSidebar
            defaultOpen={defaultOpen}
            disableChatShortcut={disableChatShortcut}
            enabled={nextEnabled}
            forceOverlay={forceOverlay}
            openOnChatRunning={openOnChatRunning}
            position={position}
            screenRefreshEnabled={screenRefreshEnabled}
          >
            <div data-testid="app-content">App content</div>
          </AgentSidebar>
        </MemoryRouter>,
      );
    });
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render(enabled);
  return render;
}

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  mockPanel.events = [];
  mockPanel.composer = undefined;
  mockTrust.frame = true;
  mockTrust.builder = false;
  window.history.replaceState({}, "", "/");
  mockHostedHarness.configured = false;
  mockHostedHarness.enabled = false;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("AgentSidebar panel", () => {
  it("defers the body import while closed and replays commands after a delayed mount", async () => {
    renderSidebar(false);
    await act(async () => {});
    await preloadAgentChatSurface();
    expect(mockPanel.imports).toBe(0);
    expect(
      container?.querySelector("[data-agent-sidebar-panel-loaded]"),
    ).toBeNull();

    mockTrust.frame = false;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: { message: "Untrusted" },
          },
        }),
      );
    });
    expect(mockPanel.imports).toBe(0);
    mockTrust.builder = true;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: { message: "Builder-only submission" },
          },
        }),
      );
    });
    expect(mockPanel.imports).toBe(0);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://builder.io",
          source: window,
          data: {
            type: "agentNative.insertComposerReference",
            data: { type: "file", path: "/builder.md" },
          },
        }),
      );
    });
    expect(mockPanel.imports).toBe(1);
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeNull();
    mockTrust.frame = true;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-panel:set-mode", {
          detail: { mode: "resources" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-panel:open-settings", {
          detail: { section: "integrations" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId: "thread-example" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "agentNative.submitChat",
            data: { message: "Draft this", submit: false },
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative:insert-composer-reference", {
          detail: { type: "file", path: "/custom-event.md" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "agentNative.insertComposerReference",
            data: { type: "file", path: "/reference.md" },
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(mockPanel.imports).toBe(1);
    expect(mockPanel.events).toEqual([]);
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeTruthy();
    await act(async () => {
      mockPanel.resolveImport();
      await mockPanel.importGate;
    });
    expect(mockPanel.events).toEqual([]);
    expect(container?.querySelector("textarea")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: document.body,
        }),
      );
    });
    expect(mockPanel.events).toHaveLength(0);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: container?.querySelector("textarea"),
        }),
      );
    });
    expect(mockPanel.events).toHaveLength(7);
    expect(mockPanel.events[0]).toEqual({
      type: "message",
      detail: {
        type: "agentNative.insertComposerReference",
        data: { type: "file", path: "/builder.md" },
      },
    });
    expect(mockPanel.events.slice(1, 5)).toEqual([
      { type: "agent-panel:set-mode", detail: { mode: "resources" } },
      {
        type: "agent-panel:open-settings",
        detail: { section: "integrations" },
      },
      {
        type: "agent-chat:open-thread",
        detail: { threadId: "thread-example" },
      },
      {
        type: "message",
        detail: {
          type: "agentNative.submitChat",
          data: { message: "Draft this", submit: false },
        },
      },
    ]);
    expect(mockPanel.events).toContainEqual({
      type: "message",
      detail: {
        type: "agentNative.insertComposerReference",
        data: { type: "file", path: "/reference.md" },
      },
    });
    expect(mockPanel.events).toContainEqual({
      type: "agentNative:insert-composer-reference",
      detail: { type: "file", path: "/custom-event.md" },
    });
  });

  it("retains references and later submissions across ready-disabled-ready transitions", async () => {
    renderSidebar(false);
    await act(async () =>
      window.dispatchEvent(new CustomEvent("agent-panel:prepare")),
    );
    const element = container!.querySelector("textarea")!;
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: element,
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-unavailable", {
          detail: element,
        }),
      ),
    );
    mockPanel.events = [];
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
          detail: { label: "Reference", refType: "file", refId: "/queued.md" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: { message: "Use the reference", submit: false },
          },
          origin: window.location.origin,
        }),
      );
    });
    expect(mockPanel.events).toEqual([]);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: element,
        }),
      ),
    );
    expect(mockPanel.events.map((e) => e.type)).toEqual([
      AGENT_CHAT_INSERT_REFERENCE_EVENT,
      "message",
    ]);
    expect(mockPanel.events[1].detail).toEqual({
      type: "agentNative.submitChat",
      data: { message: "Use the reference", submit: false },
    });
  });

  it("commits a retained reference in the real editor before replaying its submission", async () => {
    let setDisabled!: (disabled: boolean) => void;
    function Composer() {
      const runtime = useLocalRuntime({ async *run() {} });
      const [disabled, updateDisabled] = React.useState(false);
      setDisabled = updateDisabled;
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <TooltipProvider>
            <TiptapComposer
              disabled={disabled}
              includeDefaultSlashSkills={false}
              plusMenuMode="hidden"
              voiceEnabled={false}
            />
          </TooltipProvider>
        </AssistantRuntimeProvider>
      );
    }
    mockPanel.composer = <Composer />;
    renderSidebar(false);
    await act(async () =>
      window.dispatchEvent(new CustomEvent("agent-panel:prepare")),
    );
    await act(async () => setDisabled(true));
    const submissions: string[] = [];
    const observeSubmission = (event: MessageEvent) => {
      if (event.data?.type === "agentNative.submitChat")
        submissions.push(container!.textContent!);
    };
    window.addEventListener("message", observeSubmission);
    try {
      mockPanel.events = [];
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: {
              label: "Queued document",
              refType: "file",
              refId: "/queued-document.md",
              slotKey: "document",
              insertMessageId: "ordered-reference",
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            data: {
              type: "agentNative.submitChat",
              data: {
                message: "Use that document",
                submit: false,
                openSidebar: false,
              },
            },
          }),
        );
      });
      expect(mockPanel.events).toEqual([]);
      expect(submissions).toEqual([]);
      await act(async () => setDisabled(false));
      expect(mockPanel.events.map((event) => event.type)).toEqual([
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        "message",
      ]);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toContain("Queued document");
    } finally {
      window.removeEventListener("message", observeSubmission);
    }
  });

  it("keeps pending work mounted when its chat run ends", async () => {
    await act(async () => {
      mockPanel.resolveImport();
      await mockPanel.importGate;
    });
    renderSidebar(false);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "pending-run" },
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
          detail: { label: "Reference", refType: "file", refId: "/pending.md" },
        }),
      ),
    );
    mockPanel.events = [];
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "pending-run" },
        }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    const element = container!.querySelector("textarea");
    expect(element).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-ready", {
          detail: element,
        }),
      ),
    );
    expect(mockPanel.events).toHaveLength(1);
    expect(mockPanel.events[0].type).toBe(AGENT_CHAT_INSERT_REFERENCE_EVENT);
  });

  it("owns deferred delivery before previously registered receiver listeners", async () => {
    const receiver = vi.fn();
    window.addEventListener("message", receiver);
    try {
      renderSidebar(false);
      await act(async () =>
        window.dispatchEvent(new CustomEvent("agent-panel:prepare")),
      );
      const element = container!.querySelector("textarea")!;
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: { label: "Reference", refType: "file", refId: "/first.md" },
          }),
        );
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agentNative.submitChat",
              data: { message: "Queued once", submit: false },
            },
            origin: window.location.origin,
          }),
        );
      });
      expect(receiver).not.toHaveBeenCalled();
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-ready", {
            detail: element,
          }),
        ),
      );
      expect(receiver).toHaveBeenCalledOnce();
      expect(mockPanel.events.map((event) => event.type)).toEqual([
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        "message",
      ]);
    } finally {
      window.removeEventListener("message", receiver);
    }
  });

  it("pauses a reentrant drain for the current editor and ignores stale editor cleanup", async () => {
    renderSidebar(false);
    await act(async () =>
      window.dispatchEvent(new CustomEvent("agent-panel:prepare")),
    );
    const oldElement = container!.querySelector("textarea")!;
    const element = document.createElement("textarea");
    oldElement.parentElement!.appendChild(element);
    const enqueueDuringReplay = (event: Event) => {
      if ((event as CustomEvent).detail.refId !== "/first.md") return;
      window.dispatchEvent(
        new CustomEvent("agentNative:composer-reference-unavailable", {
          detail: element,
        }),
      );
      window.dispatchEvent(
        new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
          detail: { label: "Second", refType: "file", refId: "/second.md" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agentNative.submitChat",
            data: { message: "After both", submit: false },
          },
          origin: window.location.origin,
        }),
      );
    };
    window.addEventListener(
      AGENT_CHAT_INSERT_REFERENCE_EVENT,
      enqueueDuringReplay,
    );
    try {
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
            detail: { label: "First", refType: "file", refId: "/first.md" },
          }),
        ),
      );
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-ready", {
            detail: element,
          }),
        ),
      );
      expect(mockPanel.events).toHaveLength(1);
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-ready", {
            detail: element,
          }),
        );
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-unavailable", {
            detail: oldElement,
          }),
        );
      });
      expect(mockPanel.events.map((event) => event.type)).toEqual([
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        "message",
      ]);
    } finally {
      window.removeEventListener(
        AGENT_CHAT_INSERT_REFERENCE_EVENT,
        enqueueDuringReplay,
      );
    }
  });

  it.each([
    "agentNative.submitChat",
    "agentNative.setChatContext",
    "agentNative.removeChatContext",
    "agentNative.clearChatContext",
    "agentNative.insertComposerReference",
  ])("activates a closed body to deliver %s", async (type) => {
    renderSidebar(false);
    await act(async () => {});
    expect(container?.querySelector("textarea")).toBeNull();
    const data = {
      type,
      data: {
        message: "Draft",
        key: "context",
        type: "file",
        path: "/reference.md",
        openSidebar: false,
      },
    };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data }));
    });
    expect(container?.querySelector("textarea")).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeNull();
    if (type === "agentNative.insertComposerReference") {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agentNative:composer-reference-ready", {
            detail: container?.querySelector("textarea"),
          }),
        );
      });
    }
    expect(mockPanel.events).toEqual([{ type: "message", detail: data }]);
  });

  it.each(["/?agentSidebar=open", "/?threadId=thread-example"])(
    "opens a closed preference from %s",
    async (url) => {
      localStorage.setItem("agent-native-sidebar-open", "false");
      window.history.replaceState({}, "", url);
      renderSidebar(false);
      await act(async () => {});
      expect(
        container?.querySelector("[data-agent-sidebar-state='open']"),
      ).toBeTruthy();
      expect(container?.querySelector("textarea")).toBeTruthy();
    },
  );

  it("keeps an explicit URL close ahead of a thread link", async () => {
    window.history.replaceState(
      {},
      "",
      "/?agentSidebar=closed&threadId=thread-example",
    );
    renderSidebar(true);
    await act(async () => {});
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeNull();
    expect(container?.querySelector("textarea")).toBeNull();
  });

  it("prepares the body in the background without opening it", async () => {
    renderSidebar(false);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-panel:prepare"));
    });
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeNull();
    expect(container?.querySelector("textarea")).toBeTruthy();
  });

  it("opens automatically when a chat starts running", async () => {
    renderSidebar(false, undefined, false, true, true, false, true);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-panel:close"));
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "running-chat" },
        }),
      );
    });
    expect(
      container?.querySelector("[data-agent-sidebar-state='open']"),
    ).toBeTruthy();
    expect(container?.querySelector("textarea")).toBeTruthy();
  });

  it("pauses screen refresh until the panel is active", () => {
    renderSidebar(false);

    expect(
      container?.querySelector("[data-testid='app-content']"),
    ).toBeTruthy();
    expect(
      container
        ?.querySelector("[data-testid='screen-refresh-boundary']")
        ?.getAttribute("data-active"),
    ).toBe("false");
  });

  it("can disable screen refresh on public documentation pages", () => {
    renderSidebar(false, undefined, false, true, false);

    expect(
      container
        ?.querySelector("[data-testid='screen-refresh-boundary']")
        ?.getAttribute("data-active"),
    ).toBe("false");
  });

  it("defaults hosted-harness chat to the right and respects a closed preference", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    renderSidebar(false);

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-position='right']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-position='right']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
    expect(
      container
        ?.querySelector(".agent-sidebar-shell")
        ?.getAttribute("data-agent-native-hosted-harness-ui"),
    ).toBe("desktop");
  });

  it("respects an explicit position in hosted-harness UI", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    renderSidebar(false, "left");

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-position='left']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-position='left']"),
    ).toBeTruthy();
  });

  it("respects a saved closed state when hosted harness would otherwise open", async () => {
    mockHostedHarness.configured = true;
    mockHostedHarness.enabled = true;
    localStorage.setItem("agent-native-sidebar-open", "false");
    renderSidebar(true);

    await act(async () => {});

    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
  });

  it("keeps URL synchronization mounted while the panel is closed", () => {
    renderSidebar(false);

    expect(
      container?.querySelector("[data-testid='agent-sidebar-url-sync']"),
    ).toBeTruthy();
  });

  it("renders an interactive composer after loading the body", async () => {
    localStorage.setItem("agent-native-sidebar-open", "true");
    renderSidebar(true);
    await act(async () => {});

    expect(
      container?.querySelector("[data-testid='app-content']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-panel-skeleton='true']"),
    ).toBeNull();
    const composer = container?.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label='Chat composer']",
    );
    expect(composer).toBeTruthy();
    const panel = container?.querySelector<HTMLElement>(
      ".agent-sidebar-panel[data-agent-sidebar-layout='desktop']",
    );
    expect(panel?.style.getPropertyValue("--agent-sidebar-background")).toBe(
      "var(--agent-kit-nav-surface)",
    );

    expect(composer?.isConnected).toBe(true);
    expect(composer?.disabled).toBe(false);
    composer!.value = "hello";
    expect(composer?.value).toBe("hello");
  });

  it("can overlay the agent panel above the mobile breakpoint", () => {
    renderSidebar(true, "right", false, true, true, true);

    const panel = container?.querySelector<HTMLElement>(
      ".agent-sidebar-panel[data-agent-sidebar-state='open']",
    );
    expect(panel?.dataset.agentSidebarLayout).toBe("overlay");
    expect(panel?.style.position).toBe("fixed");
    expect(container?.querySelector(".agent-sidebar-backdrop")).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
  });

  it("opens from the global shortcut with the composer available", async () => {
    renderSidebar(false);
    await act(async () => {});

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "\\",
          code: "Backslash",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(
      container?.querySelector(
        ".agent-sidebar-panel[data-agent-sidebar-state='open']",
      ),
    ).toBeTruthy();
    expect(
      container?.querySelector("[data-agent-sidebar-panel-loaded='true']"),
    ).toBeTruthy();
    expect(
      container?.querySelector("textarea[aria-label='Chat composer']"),
    ).toBeTruthy();
  });

  it("leaves Cmd+I available to the app when the chat shortcut is disabled", async () => {
    renderSidebar(false, undefined, true);
    await act(async () => {});

    const onOpen = vi.fn();
    window.addEventListener("agent-panel:open", onOpen);
    const event = new KeyboardEvent("keydown", {
      key: "i",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      document.dispatchEvent(event);
    });

    window.removeEventListener("agent-panel:open", onOpen);
    expect(event.defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      container?.querySelector("[data-agent-sidebar-main-state='closed']"),
    ).toBeTruthy();
  });

  it("does not handle global shortcuts, URL overrides, or sidebar events while disabled", async () => {
    localStorage.setItem("agent-native-sidebar-open", "false");
    window.history.replaceState({}, "", "/?agentSidebar=open");
    const setEnabled = renderSidebar(false, undefined, false, false);

    await act(async () => {});

    const onOpen = vi.fn();
    const onToggle = vi.fn();
    window.addEventListener("agent-panel:open", onOpen);
    window.addEventListener("agent-panel:toggle", onToggle);

    const chatShortcut = new KeyboardEvent("keydown", {
      key: "i",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const toggleShortcut = new KeyboardEvent("keydown", {
      key: "\\",
      code: "Backslash",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      document.dispatchEvent(chatShortcut);
      document.dispatchEvent(toggleShortcut);
    });

    window.removeEventListener("agent-panel:open", onOpen);
    window.removeEventListener("agent-panel:toggle", onToggle);
    expect(chatShortcut.defaultPrevented).toBe(false);
    expect(toggleShortcut.defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    expect(localStorage.getItem("agent-native-sidebar-open")).toBe("false");
    expect(window.location.search).toBe("?agentSidebar=open");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-panel:open"));
    });
    expect(localStorage.getItem("agent-native-sidebar-open")).toBe("false");
    expect(
      container?.querySelector('[data-agent-sidebar-main-state="closed"]'),
    ).toBeTruthy();

    localStorage.setItem("agent-native-sidebar-open", "true");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-panel:close"));
    });
    expect(localStorage.getItem("agent-native-sidebar-open")).toBe("true");

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-panel:toggle"));
    });
    expect(
      container?.querySelector('[data-agent-sidebar-main-state="closed"]'),
    ).toBeTruthy();

    localStorage.setItem("agent-native-sidebar-open", "false");
    window.history.replaceState({}, "", "/");
    setEnabled(true);
    expect(
      container?.querySelector('[data-agent-sidebar-main-state="closed"]'),
    ).toBeTruthy();
  });

  it("restores screen refresh while the panel is open", () => {
    renderSidebar(true, undefined, false, true, true);

    expect(
      container
        ?.querySelector("[data-testid='screen-refresh-boundary']")
        ?.getAttribute("data-active"),
    ).toBe("true");
  });
});
