// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

const mocks = vi.hoisted(() => ({
  systemsEnabled: true,
  systemsLoading: false,
  systemsError: null as unknown,
  systemIds: ["default-system", "linked-system", "override-system"],
  systemsQuery: vi.fn(),
  refetchSystems: vi.fn(),
  createDesign: vi.fn(),
  createFromTemplate: vi.fn(),
  generateTitle: vi.fn(),
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  queryString: "",
  locationHash: "",
  locationKey: "initial",
  navigationType: "POP",
  nanoid: vi.fn(() => "design-1"),
  queryClient: {
    setQueryData: vi.fn(),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
  promptProps: null as Record<string, any> | null,
  toastError: vi.fn(),
  writePendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
  fullAppBuilding: false,
  suggestionSession: {
    authUserId: "viewer-a",
    userId: "viewer-a",
    email: "viewer-a@example.test",
    orgId: "org-a",
  },
  suggestionRole: "design" as string | null,
  suggestionProfileFetching: false,
  suggestionProfileError: false,
  suggestionProfileQueryScope: null as readonly unknown[] | null,
  homeSuggestionEvent: vi.fn(),
  ownCount: 0,
  ownedCount: 0,
  ownStatus: "success",
  templatesError: false,
  summaryParams: null as Record<string, unknown> | null,
  listParams: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  focusComposer: vi.fn(),
  setComposerText: vi.fn(),
  submitWithText: vi.fn(),
  submitDraft: vi.fn(async () => true),
  getDraftSnapshot: vi.fn(),
  agentEngine: { state: "configured", missing: false, canChat: true },
  requireAgentEngineConfiguredForDispatch: vi.fn(async () => {}),
  starterPrompt: "Un panel de análisis con cuatro indicadores clave.",
  trackDesignRelay: vi.fn(),
}));

vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: (...args: unknown[]) => mocks.trackDesignRelay(...args),
  runWhenTabVisible: (callback: () => void) => (callback(), () => {}),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useChatModels: vi.fn(),
  useAgentEngineConfigured: () => mocks.agentEngine,
  requireAgentEngineConfiguredForDispatch:
    mocks.requireAgentEngineConfiguredForDispatch,
}));

vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: (...args: unknown[]) => mocks.homeSuggestionEvent(...args),
}));

vi.mock(
  "@agent-native/toolkit/app/chat/chat/run-recovery",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/chat/run-recovery")
    >()),
    BuilderSetupCard: ({
      bouncePulse = 0,
      onConnected,
    }: {
      bouncePulse?: number;
      onConnected?: () => void;
    }) => (
      <div
        data-setup-card
        data-testid="ai-setup-card"
        data-bounce-pulse={bouncePulse}
      >
        Connect AI
        <button type="button" onClick={onConnected}>
          Use Builder.io
        </button>
        <a href="/settings/keys">Custom keys</a>
      </div>
    ),
  }),
);
vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: () => null,
}));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: ({ onRetry }: { onRetry: () => void }) => (
    <button data-query-error onClick={onRetry}>
      Retry
    </button>
  ),
}));

vi.mock("@agent-native/core/client/labs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/labs")>()),
  useLab: () => mocks.fullAppBuilding,
}));

vi.mock("@agent-native/core/client/collab", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/collab")
  >()),
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
}));

vi.mock("@agent-native/core/client/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/org")>()),
  useOrgMembers: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => mocks.systemsEnabled,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: async () => ({ agentContext: "Frozen selected system" }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: (
    name: string,
    params: Record<string, unknown>,
    options?: {
      enabled?: boolean;
      queryKeyScope?: readonly unknown[];
      staleTime?: unknown;
      refetchOnMount?: unknown;
      refetchOnWindowFocus?: unknown;
      refetchOnReconnect?: unknown;
    },
  ) => {
    if (name === "get-user-profile") {
      mocks.suggestionProfileQueryScope = options?.queryKeyScope ?? null;
      const enabled = options?.enabled !== false;
      return {
        data:
          enabled &&
          !mocks.suggestionProfileError &&
          !mocks.suggestionProfileFetching
            ? { onboardingRole: mocks.suggestionRole }
            : undefined,
        isLoading: enabled && mocks.suggestionProfileFetching,
        isFetching: enabled && mocks.suggestionProfileFetching,
        isSuccess:
          enabled &&
          !mocks.suggestionProfileError &&
          !mocks.suggestionProfileFetching,
        isError: enabled && mocks.suggestionProfileError,
      };
    }
    if (name === "list-designs") {
      if (params.compact === "true") {
        if (params.createdBy === "all") mocks.summaryParams = params;
        return {
          data: {
            totalCount:
              params.createdBy === "me" ? mocks.ownedCount : mocks.ownCount,
          },
          isSuccess: mocks.ownStatus === "success",
          isError: mocks.ownStatus === "error",
          isFetching: false,
          refetch: mocks.refetch,
        };
      }
      mocks.listParams = params;
      return {
        data: { count: 0, totalCount: 0, designs: [] },
        isLoading: false,
      };
    }
    if (name === "list-design-templates") {
      return {
        data: {
          count: 2,
          templates: [
            {
              id: "starter-template",
              title: "Starter template",
              isBuiltIn: true,
              previewHtml: "<main>Starter</main>",
            },
            {
              id: "saved-template",
              title: "Saved template",
              description: "Reusable campaign",
              category: "social",
              designSystemId: "linked-system",
              isBuiltIn: false,
              previewHtml: "<main>Saved</main>",
            },
          ],
        },
        isLoading: false,
        isError: mocks.templatesError,
        refetch: mocks.refetch,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "create-design"
        ? mocks.createDesign
        : name === "create-design-from-template"
          ? mocks.createFromTemplate
          : name === "generate-design-title"
            ? mocks.generateTitle
            : vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn(),
  }),
  useSession: () => ({
    session: mocks.suggestionSession,
    isLoading: false,
    status: "authenticated",
    error: null,
    retry: vi.fn(),
  }),
  useAvatarUrl: () => null,
  useChangeVersion: () => 0,
  useChangeVersions: () => 0,
  getBrowserTabId: () => "tab-1",
  readClientAppState: async () => null,
  setClientAppState: async () => undefined,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useFormatters: () => ({ formatDate: (value: string) => value }),
  useT: () => (key: string) => {
    if (key === "home.untitledDesign") return "Untitled Design";
    if (key === "home.starterDashboardPrompt") return mocks.starterPrompt;
    if (key === "home.suggestions.design.portfolioHome") {
      return mocks.starterPrompt;
    }
    if (key === "home.searchNoResultsTitle") {
      return "No designs match your search";
    }
    if (key === "home.searchNoResultsDescription") {
      return "Try a different search.";
    }
    if (key === "promptDialog.skipPrompt") return "Skip prompt";
    if (key === "home.failedToCreateDesign") {
      return "Failed to create design";
    }
    return key;
  },
}));

vi.mock("@agent-native/toolkit/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app-shell")>()),
  useHomeSearchShortcut: vi.fn(),
  useHomeSuggestionRole: () => "general",
  useSetPageTitle: () => {},
  writeHomeSuggestionRole: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareSheet: () => null,
  parseCreativeContexts: () => [],
  useCreativeContextLab: () => false,
  useCreativeContexts: () => ({ data: undefined, isLoading: false }),
  useCreativeContextState: () => ({
    state: { contextMode: "auto", selectedContextId: null },
    setState: vi.fn(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ hash: mocks.locationHash, key: mocks.locationKey }),
  useNavigate: () => mocks.navigate,
  useNavigationType: () => mocks.navigationType,
  useSearchParams: () => [
    new URLSearchParams(mocks.queryString),
    mocks.setSearchParams,
  ],
  Link: ({ children, to, ...props }: Record<string, any>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("nanoid", () => ({
  nanoid: () => mocks.nanoid(),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  preloadPromptComposer: vi.fn(),
  default: (props: Record<string, any>) => {
    mocks.promptProps = props;
    if (props.composerRef)
      props.composerRef.current = {
        focus: mocks.focusComposer,
        setText: mocks.setComposerText,
        submitWithText: mocks.submitWithText,
        submit: mocks.submitDraft,
        getDraftSnapshot: mocks.getDraftSnapshot,
      };
    return null;
  },
}));

vi.mock(
  "@agent-native/toolkit/app/chat/composer/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/composer/index")
    >()),
    PromptComposer: () => null,
    snapshotComposerContextItems: (items: unknown) => items,
    useAgentKitIntegrationMenu: () => ({
      id: "integrations",
      label: "Integrations",
      intent: "invoke-integration",
      picker: {
        scopeKey: "test",
        searchPlaceholder: "Search integrations",
        items: [],
        loading: false,
        emptyMessage: "No integrations",
        onSelect: () => {},
      },
    }),
    useAgentKitCapabilities: () => ({
      data: { sources: { figma: { available: true } }, integrations: [] },
    }),
  }),
);

vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: (enabled: boolean) => (
    mocks.systemsQuery(enabled),
    {
      designSystems:
        mocks.systemsLoading || mocks.systemsError
          ? []
          : [
              {
                id: "default-system",
                title: "Default system",
                isDefault: true,
                data: "{}",
              },
              {
                id: "linked-system",
                title: "Linked system",
                isDefault: false,
                data: "{}",
              },
              {
                id: "override-system",
                title: "Override system",
                isDefault: false,
                data: "{}",
              },
            ].filter((system) => mocks.systemIds.includes(system.id)),
      defaultSystem: {
        id: "default-system",
        title: "Default system",
        isDefault: true,
        data: "{}",
      },
      isLoading: mocks.systemsLoading,
      error: mocks.systemsError,
      refetch: mocks.refetchSystems,
    }
  ),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  writePendingGeneration: (...args: unknown[]) =>
    mocks.writePendingGeneration(...args),
  clearPendingGeneration: (...args: unknown[]) =>
    mocks.clearPendingGeneration(...args),
}));

let container: HTMLDivElement;
let root: Root;

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(async () => {
  installLocalStorage();
  window.localStorage.clear();
  window.sessionStorage.clear();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.queryString = "";
  mocks.locationHash = "";
  mocks.locationKey = "initial";
  mocks.navigationType = "POP";
  mocks.refetchSystems.mockReset();
  mocks.nanoid.mockReturnValue("design-1");
  mocks.createFromTemplate.mockResolvedValue({
    id: "copied-design",
    title: "Saved template",
    designSystemId: "override-system",
    adaptationPending: false,
    templateBaselineFiles: [{ id: "file-1", contentHash: "baseline" }],
  });
  mocks.generateTitle.mockResolvedValue(undefined);
  mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
  mocks.promptProps = null;
  mocks.setComposerText.mockReset();
  mocks.fullAppBuilding = false;
  mocks.suggestionSession = {
    authUserId: "viewer-a",
    userId: "viewer-a",
    email: "viewer-a@example.test",
    orgId: "org-a",
  };
  mocks.suggestionRole = "design";
  mocks.suggestionProfileFetching = false;
  mocks.suggestionProfileError = false;
  mocks.suggestionProfileQueryScope = null;
  mocks.homeSuggestionEvent.mockReset();
  mocks.systemsEnabled = true;
  mocks.systemsLoading = false;
  mocks.systemsError = null;
  mocks.systemIds = ["default-system", "linked-system", "override-system"];
  mocks.ownCount = 0;
  mocks.ownedCount = 0;
  mocks.ownStatus = "success";
  mocks.templatesError = false;
  mocks.agentEngine = { state: "configured", missing: false, canChat: true };
  mocks.requireAgentEngineConfiguredForDispatch.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Index />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("does not query or apply a default system when workflows are disabled", async () => {
  mocks.createDesign.mockResolvedValue(undefined);
  mocks.systemsEnabled = false;
  mocks.systemsQuery.mockClear();
  await act(async () => root.render(<Index />));
  expect(mocks.systemsQuery).toHaveBeenLastCalledWith(false);
  expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  expect(
    mocks.promptProps?.contextMenuItems[0].children.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual([
    "design-reference",
    "figma-reference",
    "website-reference",
    "integrations",
  ]);
  await act(async () => mocks.promptProps?.onSubmit("New design", [], {}));
  expect(mocks.createDesign).toHaveBeenCalledWith(
    expect.objectContaining({ designSystemId: null }),
  );
});

it("does not auto-attach the default design system to a fresh prompt", async () => {
  expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  expect(mocks.promptProps?.contextItems).not.toContainEqual(
    expect.objectContaining({ title: "Default system" }),
  );

  await act(async () => {
    await mocks.promptProps?.onSubmit?.("New design", [], {});
  });

  expect(mocks.createDesign).toHaveBeenCalledWith(
    expect.objectContaining({ designSystemId: null }),
  );
  expect(mocks.writePendingGeneration).toHaveBeenCalledWith(
    "design-1",
    expect.objectContaining({ designSystemId: null }),
  );
});

// oracle-change: replace generator loading, cache and timeout states with fixed prompt pools.
describe("Index skip to editor", () => {
  it("keeps home suggestions enabled before and after connection", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));

    let bar = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-bar="true"]',
    );
    expect(
      bar?.querySelectorAll('[data-agent-suggestion-chip="true"]'),
    ).toHaveLength(3);
    expect(
      [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
    expect(container.textContent).toContain("Connect AI");

    mocks.agentEngine = { state: "configured", missing: false, canChat: true };
    await act(async () => root.render(<Index />));
    bar = container.querySelector<HTMLElement>(
      '[data-agent-suggestion-bar="true"]',
    );
    expect(
      [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
    const actionsRow = container.querySelector("[data-home-prompt-actions]");
    const skipButton = container.querySelector(
      '[data-testid="design-home-skip-prompt"]',
    );
    expect(actionsRow).toBeTruthy();
    expect(skipButton?.closest("[data-home-prompt-actions]")).toBe(actionsRow);
  });

  it("keeps the suggestion row beside a selected template", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );

    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(
      container.querySelector("[data-home-prompt-actions]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-agent-suggestion-bar="true"]'),
    ).not.toBeNull();
  });

  it("explains an unaccepted quick start without replacing the draft or creating a design", async () => {
    mocks.submitWithText.mockResolvedValueOnce(false);
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[data-agent-suggestion-position="1"]',
    );
    await act(async () => suggestion?.click());
    expect(mocks.toastError).toHaveBeenCalledWith("homeContext.notReady");
    expect(mocks.promptProps?.initialText).toBeUndefined();
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
  });
  it("submits the localized quick start through the current composer without replacing its draft or selections", async () => {
    mocks.submitWithText.mockResolvedValue(true);
    await act(async () =>
      mocks.promptProps?.onDesignSystemChange("override-system"),
    );
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[data-agent-suggestion-position="1"]',
    );
    await act(async () => suggestion?.click());
    expect(mocks.submitWithText).toHaveBeenCalledWith(
      expect.stringMatching(/^home\.suggestions\.design\./),
    );
    expect(mocks.promptProps?.initialText).toBeUndefined();
    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("override-system");
    await act(async () => suggestion?.click());
    expect(mocks.submitWithText).toHaveBeenCalledTimes(2);
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
  });

  it("persists one empty shell before navigating without starting generation", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("Connect AI");
    expect(mocks.promptProps).toMatchObject({ requireAgentEngine: true });
    expect(
      mocks.requireAgentEngineConfiguredForDispatch,
    ).not.toHaveBeenCalled();

    let resolveCreate: (() => void) | undefined;
    mocks.createDesign.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    expect(mocks.promptProps?.skipLabel).toBe("Skip prompt");
    expect(mocks.promptProps?.showInlineSkip).toBe(false);
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
    const skipButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="design-home-skip-prompt"]',
    );
    const actionsRow = skipButton?.closest("[data-home-prompt-actions]");
    expect(actionsRow).toBeTruthy();
    expect(skipButton).toBeTruthy();
    expect(
      actionsRow?.querySelector('[data-agent-suggestion-bar="true"]'),
    ).not.toBeNull();
    expect(
      actionsRow?.querySelectorAll('[data-agent-suggestion-chip="true"]'),
    ).toHaveLength(3);
    expect(actionsRow?.className).toContain("justify-between");
    expect(skipButton?.className).toContain("font-normal");
    await act(async () => {
      skipButton?.click();
      await Promise.resolve();
    });

    expect(mocks.createDesign).toHaveBeenCalledTimes(1);
    expect(mocks.createDesign).toHaveBeenCalledWith({
      id: "design-1",
      title: "Untitled Design",
      projectType: "prototype",
      designSystemId: null,
      creationMethod: "blank",
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.generateTitle).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.();
      await Promise.resolve();
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-1");
  });

  it("keeps template adaptation in the home composer until AI is connected", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    mocks.requireAgentEngineConfiguredForDispatch.mockRejectedValue(
      new Error("AI setup required"),
    );
    await act(async () => root.render(<Index />));
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });
    expect(mocks.promptProps?.showInlineSkip).toBe(false);

    let shouldClose: boolean | void = undefined;
    await act(async () => {
      shouldClose = await mocks.promptProps?.onSkip();
    });

    expect(shouldClose).toBe(false);
    expect(container.textContent).toContain("Connect AI");
    expect(
      mocks.requireAgentEngineConfiguredForDispatch,
    ).toHaveBeenCalledOnce();
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows the inline prompt without New buttons or creation side effects", () => {
    expect(mocks.promptProps).toMatchObject({
      inline: true,
      open: true,
      draftScope: expect.stringMatching(/^design:new:0:/),
    });
    expect(container.textContent).not.toContain("home.newDesign");
    expect(container.textContent).not.toContain("home.createFirstDesign");
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("retains the feature-gated design-or-app choice", async () => {
    expect(mocks.promptProps?.creationMode).toBeUndefined();
    mocks.fullAppBuilding = true;
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps?.creationMode).toBe("design");
    await act(async () => mocks.promptProps?.onCreationModeChange("app"));
    expect(mocks.promptProps?.creationMode).toBe("app");
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("gates chat while offering provider setup and keeps the card attached to the home composer", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Custom keys");
    const connect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Use Builder.io"),
    );
    expect(connect).toBeDefined();
    expect(
      Array.from(container.querySelectorAll("a")).some(
        (link) =>
          link.textContent === "Custom keys" &&
          link.href.endsWith("/settings/keys"),
      ),
    ).toBe(true);
    expect(mocks.promptProps?.disabled).not.toBe(true);
    expect(mocks.promptProps).toMatchObject({
      requireAgentEngine: true,
      showMissingApiKeySetup: false,
      showModelSelector: true,
      modelStatusChecksEnabled: true,
    });
    expect(mocks.promptProps?.onBeforeSubmit).toBeUndefined();
    expect(mocks.promptProps?.composerComponent).toBeDefined();
    expect(
      mocks.requireAgentEngineConfiguredForDispatch,
    ).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Connect AI");
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();

    const dispatch = vi.spyOn(window, "dispatchEvent");
    await act(async () => connect?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-engine:configured-changed" }),
    );
    dispatch.mockRestore();

    const composer = container.querySelector<HTMLElement>(
      "[data-design-home-composer]",
    )!;
    expect(composer.className).toContain("agent-composer-area--attached-above");
    await act(async () =>
      composer.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(
      container
        .querySelector("[data-setup-card][data-bounce-pulse]")
        ?.getAttribute("data-bounce-pulse"),
    ).toBe("1");

    mocks.agentEngine = { state: "configured", missing: false, canChat: true };
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps?.disabled).not.toBe(true);
    expect(mocks.promptProps).toMatchObject({
      requireAgentEngine: true,
      showMissingApiKeySetup: false,
      showModelSelector: true,
      modelStatusChecksEnabled: true,
    });
    expect(mocks.promptProps?.onBeforeSubmit).toBeUndefined();
    expect(container.textContent).not.toContain("Connect AI");
    expect(container.querySelector("[data-testid='ai-setup-card']")).toBeNull();
  });

  it("keeps unknown provider status editable and delegates submit admission to the shared composer", async () => {
    mocks.agentEngine = { state: "unknown", missing: false, canChat: false };
    await act(async () => root.render(<Index />));
    expect(container.textContent).not.toContain(
      "agentChat.setup.checkingProvider",
    );
    expect(
      container.querySelector('[role="status"][aria-label="common.loading"]'),
    ).toBeNull();
    expect(mocks.promptProps?.disabled).not.toBe(true);
    expect(mocks.promptProps).toMatchObject({
      requireAgentEngine: true,
      showMissingApiKeySetup: false,
      showModelSelector: true,
      modelStatusChecksEnabled: true,
    });
    expect(mocks.promptProps?.onBeforeSubmit).toBeUndefined();
    expect(
      mocks.requireAgentEngineConfiguredForDispatch,
    ).not.toHaveBeenCalled();

    mocks.agentEngine = {
      state: "unavailable",
      missing: false,
      canChat: false,
    };
    await act(async () => root.render(<Index />));
    expect(container.textContent).not.toContain(
      "agentChat.setup.providerStatusUnavailable",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "agentChat.common.retry",
      ),
    ).toBe(false);
  });

  it("renders three suggestions while the profile role is still loading", async () => {
    await act(async () => root.render(null));
    mocks.suggestionProfileFetching = true;
    mocks.suggestionRole = null;
    await act(async () => root.render(<Index />));

    const bar = container.querySelector<HTMLElement>(
      '[aria-label="home.suggestedPrompts"]',
    );
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-busy")).toBeNull();
    expect(
      bar?.querySelectorAll('[data-agent-suggestion-placeholder="true"]'),
    ).toHaveLength(0);
    expect(
      bar?.querySelectorAll('[data-agent-suggestion-chip="true"]'),
    ).toHaveLength(3);
    expect(bar?.textContent).toContain("home.suggestionLabels.general.");
  });

  it("switches to the onboarding role pool after the profile resolves", async () => {
    await act(async () => root.render(null));
    mocks.suggestionProfileFetching = true;
    mocks.suggestionRole = null;
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[aria-label="home.suggestedPrompts"]')
        ?.textContent,
    ).toContain("home.suggestionLabels.general.");

    mocks.suggestionProfileFetching = false;
    mocks.suggestionRole = "marketing";
    await act(async () => root.render(<Index />));
    const bar = container.querySelector<HTMLElement>(
      '[aria-label="home.suggestedPrompts"]',
    );
    expect(bar?.textContent).toContain("home.suggestionLabels.marketing.");
    expect(bar?.textContent).not.toContain("home.suggestionLabels.general.");
  });

  it("keeps suggestions available before AI setup and after connection", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));

    let bar = container.querySelector<HTMLElement>(
      '[aria-label="home.suggestedPrompts"]',
    );
    expect(
      bar?.querySelectorAll('[data-agent-suggestion-chip="true"]'),
    ).toHaveLength(3);
    expect(
      [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);

    mocks.agentEngine = { state: "configured", missing: false, canChat: true };
    await act(async () => root.render(<Index />));
    bar = container.querySelector<HTMLElement>(
      '[aria-label="home.suggestedPrompts"]',
    );
    expect(
      [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
  });

  it("prefills and tracks a suggestion before AI setup", async () => {
    mocks.agentEngine = { state: "missing", missing: true, canChat: false };
    await act(async () => root.render(<Index />));
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[data-agent-suggestion-position="1"]',
    );
    const label = suggestion?.textContent ?? "";

    await act(async () => suggestion?.click());

    const prompt = mocks.promptProps?.initialText;
    expect(prompt).toMatch(/^home\.suggestions\.design\./);
    expect(prompt).not.toBe(label);
    expect(mocks.setComposerText).toHaveBeenCalledWith(prompt);
    expect(mocks.focusComposer).toHaveBeenCalled();
    expect(mocks.homeSuggestionEvent).toHaveBeenCalledWith(
      "home_suggestion_clicked",
      expect.objectContaining({
        app_id: "design",
        role: "design",
        suggestion_id: expect.any(String),
        position: 1,
      }),
    );

    const editedPrompt = `${prompt} with a mobile version`;
    await act(async () => {
      mocks.promptProps?.onPromptTextChange?.(editedPrompt);
      await mocks.promptProps?.onSubmit(editedPrompt, [], {});
    });
    const submitEvent = mocks.trackDesignRelay.mock.calls.find(
      ([name]) => name === "design_prompt_submitted",
    );
    expect(submitEvent?.[1]).toMatchObject({ prompt_source: "composer" });
  });

  it("uses general prompts when the profile cannot be read", async () => {
    await act(async () => root.render(null));
    mocks.suggestionProfileError = true;
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[aria-label="home.suggestedPrompts"]')
        ?.textContent,
    ).toContain("home.suggestionLabels.general.");
  });

  it.each([
    { state: "missing", missing: true, ready: false },
    { state: "unknown", missing: false, ready: false },
    { state: "unavailable", missing: false, ready: false },
    { state: "configured", missing: false, ready: true },
    { state: "configured", missing: true, ready: false },
  ])(
    "shows the suggestion slot only when chat is ready for $state (missing=$missing)",
    async ({ state, missing, ready }) => {
      await act(async () => root.render(null));
      mocks.agentEngine = { state, missing, canChat: ready };
      await act(async () => root.render(<Index />));
      expect(mocks.promptProps?.disabled).not.toBe(true);
      expect(mocks.promptProps).toMatchObject({
        requireAgentEngine: true,
        showMissingApiKeySetup: false,
        showModelSelector: true,
        modelStatusChecksEnabled: true,
      });
      expect(mocks.promptProps?.onBeforeSubmit).toBeUndefined();
      expect(
        mocks.requireAgentEngineConfiguredForDispatch,
      ).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(
        "agentChat.setup.checkingProvider",
      );
      expect(container.textContent).not.toContain("Checking AI connection");
      const suggestionBar = container.querySelector<HTMLElement>(
        '[aria-label="home.suggestedPrompts"]',
      );
      expect(Boolean(suggestionBar)).toBe(true);
      expect(suggestionBar?.getAttribute("aria-busy") ?? null).toBeNull();
      expect(
        suggestionBar?.querySelectorAll('[data-agent-suggestion-chip="true"]'),
      ).toHaveLength(3);
      expect(
        [
          ...(suggestionBar?.querySelectorAll<HTMLButtonElement>("button") ??
            []),
        ].every((button) => !button.disabled),
      ).toBe(true);
    },
  );

  it("does not navigate on failure and allows a successful retry", async () => {
    mocks.createDesign
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      await expect(mocks.promptProps?.onSkip()).rejects.toThrow(
        "database unavailable",
      );
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to create design");
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.generateTitle).not.toHaveBeenCalled();

    mocks.nanoid.mockReturnValue("design-2");
    await act(async () => {
      await mocks.promptProps?.onSkip();
    });

    expect(mocks.createDesign).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-2");
  });

  it("preserves a user-selected system when a template is chosen afterward", async () => {
    await act(async () => {
      mocks.promptProps?.onDesignSystemChange("override-system");
    });

    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("override-system");
    expect(mocks.promptProps?.skipLabel).toBe("templatesPage.useTemplate");

    let shouldClose: boolean | void = undefined;
    await act(async () => {
      shouldClose = await mocks.promptProps?.onSkip();
    });

    expect(mocks.createFromTemplate).toHaveBeenCalledWith({
      templateId: "saved-template",
      title: "Saved template",
      designSystemId: "override-system",
      newId: "design-1",
      retryKey: expect.any(String),
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");
    expect(shouldClose).toBe(false);
  });

  it("resolves a linked system after the design systems finish loading", async () => {
    mocks.systemsLoading = true;
    await act(async () => root.render(<Index />));
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();

    mocks.systemsLoading = false;
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("linked-system");
  });

  it("resolves the linked template system before creating an app while systems load", async () => {
    mocks.fullAppBuilding = true;
    mocks.systemsLoading = true;
    mocks.refetchSystems.mockResolvedValue({
      isSuccess: true,
      data: {
        designSystems: [{ id: "linked-system" }],
      },
    });
    await act(async () => root.render(<Index />));
    await act(async () => mocks.promptProps?.onCreationModeChange("app"));
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );

    await act(async () => {
      await mocks.promptProps?.onSubmit("Build an app", [], {});
    });

    expect(mocks.refetchSystems).toHaveBeenCalledOnce();
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "linked-system" }),
    );
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
  });

  it("retries systems lookup before app creation when the initial query failed", async () => {
    mocks.fullAppBuilding = true;
    mocks.systemsError = new Error("systems query failed");
    mocks.refetchSystems.mockResolvedValue({
      isSuccess: true,
      data: {
        designSystems: [{ id: "linked-system" }],
      },
    });
    await act(async () => root.render(<Index />));
    await act(async () => mocks.promptProps?.onCreationModeChange("app"));
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );

    await act(async () => {
      await mocks.promptProps?.onSubmit("Build an app", [], {});
    });

    expect(mocks.refetchSystems).toHaveBeenCalledOnce();
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "linked-system" }),
    );
  });

  it("resolves a template system before skipping to a blank app after query failure", async () => {
    mocks.fullAppBuilding = true;
    mocks.systemsError = new Error("systems query failed");
    mocks.refetchSystems.mockResolvedValue({
      isSuccess: true,
      data: {
        designSystems: [{ id: "linked-system" }],
      },
    });
    await act(async () => root.render(<Index />));
    await act(async () => mocks.promptProps?.onCreationModeChange("app"));
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );

    await act(async () => {
      await mocks.promptProps?.onSkip();
    });

    expect(mocks.refetchSystems).toHaveBeenCalledOnce();
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "linked-system" }),
    );
  });

  it("clears an inaccessible linked system after loading before template copy", async () => {
    mocks.systemsLoading = true;
    await act(async () => root.render(<Index />));
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();

    mocks.systemIds = ["default-system", "override-system"];
    mocks.systemsLoading = false;
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();

    await act(async () => {
      await mocks.promptProps?.onSubmit("Copy this template", [], {});
    });
    expect(mocks.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "saved-template" }),
    );
    expect(mocks.createFromTemplate.mock.calls[0][0]).not.toHaveProperty(
      "designSystemId",
    );
  });

  it("leaves template system resolution to the copy action while systems load", async () => {
    mocks.systemsLoading = true;
    await act(async () => root.render(<Index />));
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    await act(async () => {
      await mocks.promptProps?.onSubmit("Copy this template", [], {});
    });
    expect(mocks.createFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.createFromTemplate.mock.calls[0][0]).not.toHaveProperty(
      "designSystemId",
    );
  });

  it("keeps the template-copy retry identity stable as systems load", async () => {
    mocks.nanoid
      .mockReturnValueOnce("first-copy")
      .mockReturnValue("second-copy");
    mocks.createFromTemplate.mockRejectedValueOnce(new Error("response lost"));
    mocks.systemsLoading = true;
    await act(async () => root.render(<Index />));
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    await act(async () => {
      await expect(
        mocks.promptProps?.onSubmit("Copy this template", [], {}),
      ).rejects.toThrow("response lost");
    });
    const firstCopy = mocks.createFromTemplate.mock.calls[0][0];

    mocks.systemsLoading = false;
    await act(async () => root.render(<Index />));
    await act(async () => {
      await mocks.promptProps?.onSubmit("Copy this template", [], {});
    });
    const retry = mocks.createFromTemplate.mock.calls[1][0];
    expect(retry.newId).toBe(firstCopy.newId);
    expect(retry.retryKey).toBe(firstCopy.retryKey);
    expect(retry).not.toHaveProperty("designSystemId");
  });

  it("opens a copied template without waiting for the designs list to refresh", async () => {
    let resolveRefresh: (() => void) | undefined;
    mocks.queryClient.invalidateQueries.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    let skipPromise: Promise<void> | undefined;
    await act(async () => {
      skipPromise = mocks.promptProps?.onSkip();
      await Promise.resolve();
    });

    expect(mocks.createFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");

    resolveRefresh?.();
    await act(async () => {
      await skipPromise;
    });
  });
});

describe("Index search empty state", () => {
  it("distinguishes no search matches from a first-time empty state", async () => {
    expect(container.textContent).toContain("Starter template");
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="home.searchPlaceholder"]',
    );
    expect(searchInput).not.toBeNull();

    await act(async () => {
      if (!searchInput) throw new Error("Search input not found");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "no matching design");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No designs match your search");
    expect(container.textContent).toContain("Try a different search.");
    expect(container.textContent).not.toContain("home.createFirstDesign");
    expect(container.textContent).not.toContain("home.pickStartingPoint");
    expect(container.textContent).toContain("home.suggestionLabels.design.");
  });

  it("keeps searched shared designs visible when the user owns no designs", async () => {
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));

    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="home.searchPlaceholder"]',
    );
    expect(searchInput).not.toBeNull();
    await act(async () => {
      if (!searchInput) throw new Error("Search input not found");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "shared design");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("home.recent");
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    await act(async () =>
      tabs[0]?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("home library", () => {
  it("uses an unfiltered accessible-design summary for shared-only users", async () => {
    expect(mocks.summaryParams).toEqual({
      page: 1,
      pageSize: 1,
      createdBy: "all",
      compact: "true",
      includePreview: "false",
    });
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.textContent).toContain("navigation.templates");
    expect(container.textContent).toContain("home.recent");
    expect(container.querySelector('a[href="/templates"]')).not.toBeNull();
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("home.recent");
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
  });

  it("keeps both tabs visible while the accessible-design summary is pending", async () => {
    await act(async () => root.unmount());
    mocks.ownCount = 1;
    mocks.ownStatus = "pending";
    root = createRoot(container);
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(container.textContent).toContain("home.recent");

    mocks.ownStatus = "success";
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
    expect(window.localStorage.getItem("design-home-has-recents")).toBe("true");
  });

  it("switches back to Templates when the last accessible design is removed", async () => {
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");

    mocks.ownCount = 0;
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
  });

  it("resets a manually selected Recent tab when the last design is removed", async () => {
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    const templates = tabs.find(
      (tab) => tab.textContent === "navigation.templates",
    );
    const recent = tabs.find((tab) => tab.textContent === "home.recent");
    if (!templates || !recent) throw new Error("Missing home library tabs");

    await act(async () =>
      templates.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    await act(async () =>
      recent.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );

    mocks.ownCount = 0;
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");

    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
  });

  it("does not server-render the home library", () => {
    expect(renderToString(<Index />)).not.toContain(
      "agent-prompt-home-library",
    );
  });

  it("renders ready suggestions before effects snapshot them", () => {
    expect(renderToString(<Index />)).toContain(
      'aria-label="home.suggestedPrompts"',
    );
  });

  it("keeps Recent selected for the save-template checklist destination", async () => {
    await act(async () => root.unmount());
    mocks.queryString = "gettingStarted=save-template";
    mocks.ownCount = 0;
    mocks.ownStatus = "success";
    root = createRoot(container);

    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
  });

  it("preserves a tab choice after the save-template destination query resolves", async () => {
    await act(async () => root.unmount());
    mocks.queryString = "gettingStarted=save-template";
    mocks.ownCount = 0;
    mocks.ownStatus = "pending";
    root = createRoot(container);
    await act(async () => root.render(<Index />));

    const templates = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "navigation.templates");
    if (!templates) throw new Error("Missing Templates tab");
    await act(async () =>
      templates.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    expect(templates.getAttribute("aria-selected")).toBe("true");

    mocks.ownStatus = "success";
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
  });

  it("reapplies a checklist destination when the same URL is opened again", async () => {
    await act(async () => root.unmount());
    mocks.queryString = "gettingStarted=save-template";
    mocks.locationHash = "#design-home-library";
    mocks.locationKey = "checklist-open-1";
    mocks.ownCount = 1;
    root = createRoot(container);
    await act(async () => root.render(<Index />));

    const templates = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "navigation.templates");
    if (!templates) throw new Error("Missing Templates tab");
    await act(async () =>
      templates.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    expect(templates.getAttribute("aria-selected")).toBe("true");

    mocks.locationKey = "checklist-open-2";
    mocks.navigationType = "REPLACE";
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
  });

  it("preserves the selected tab during checklist query replacements", async () => {
    await act(async () => root.unmount());
    mocks.queryString = "gettingStarted=save-template";
    mocks.locationHash = "#design-home-library";
    mocks.locationKey = "checklist-open";
    mocks.ownCount = 1;
    root = createRoot(container);
    await act(async () => root.render(<Index />));

    const templates = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "navigation.templates");
    if (!templates) throw new Error("Missing Templates tab");
    await act(async () =>
      templates.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    expect(templates.getAttribute("aria-selected")).toBe("true");

    mocks.queryString = "gettingStarted=save-template&templateId=selected";
    mocks.locationKey = "template-selection";
    mocks.navigationType = "REPLACE";
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");

    mocks.queryString =
      "gettingStarted=save-template&templateId=selected&previewTemplateId=preview";
    mocks.locationKey = "template-preview";
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
  });

  it("does not replace the checklist location when the selected template is unchanged", async () => {
    await act(async () => root.unmount());
    mocks.queryString = "gettingStarted=save-template&templateId=selected";
    root = createRoot(container);
    await act(async () => root.render(<Index />));
    mocks.setSearchParams.mockClear();

    await act(async () => mocks.promptProps?.onTemplateChange("selected"));

    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it("preserves an explicit Templates choice made while the summary is pending", async () => {
    mocks.ownCount = 1;
    mocks.ownStatus = "pending";
    await act(async () => root.render(<Index />));
    const templates = container.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    )!;
    expect(templates.textContent).toBe("navigation.templates");
    await act(async () =>
      templates.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    mocks.ownStatus = "success";
    await act(async () => root.render(<Index />));

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");

    await act(async () => root.unmount());
    mocks.ownStatus = "success";
    root = createRoot(container);
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");
  });

  it("does not treat pending or failed ownership reads as successful empty results", async () => {
    mocks.ownCount = 3;
    mocks.ownStatus = "pending";
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    mocks.ownStatus = "error";
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
    const retry =
      container.querySelector<HTMLButtonElement>("[data-query-error]");
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("restores cached recents immediately and refreshes the cache after a successful read", async () => {
    await act(async () => root.unmount());
    window.localStorage.setItem("design-home-has-recents", "true");
    mocks.ownCount = 1;
    mocks.ownStatus = "pending";
    root = createRoot(container);
    await act(async () => root.render(<Index />));

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");

    mocks.ownStatus = "success";
    await act(async () => root.render(<Index />));
    expect(window.localStorage.getItem("design-home-has-recents")).toBe("true");

    await act(async () => root.unmount());
    mocks.ownCount = 0;
    mocks.ownStatus = "pending";
    root = createRoot(container);
    await act(async () => root.render(<Index />));
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("home.recent");

    mocks.ownStatus = "success";
    await act(async () => root.render(<Index />));
    expect(window.localStorage.getItem("design-home-has-recents")).toBe(
      "false",
    );
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("navigation.templates");
  });

  it("shows template errors with retry rather than an empty grid", async () => {
    mocks.templatesError = true;
    await act(async () => root.render(<Index />));
    expect(container.querySelector("[data-query-error]")).not.toBeNull();
    expect(container.textContent).not.toContain(
      "promptDialog.noTemplatesFound",
    );
  });

  it("opens a gallery template preview without copying, submitting or changing the draft", async () => {
    const originalPrompt = mocks.promptProps;
    const template = Array.from(
      container.querySelectorAll<HTMLElement>("button"),
    ).find((button) => button.textContent?.includes("Starter template"));
    await act(async () => template?.click());
    const update = mocks.setSearchParams.mock.lastCall?.[0] as (
      current: URLSearchParams,
    ) => URLSearchParams;
    expect(update(new URLSearchParams()).get("previewTemplateId")).toBe(
      "starter-template",
    );
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
    expect(mocks.promptProps?.selectedTemplateId).toBe(
      originalPrompt?.selectedTemplateId,
    );
    expect(mocks.focusComposer).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("home funnel tracking", () => {
  const promptEvents = () =>
    mocks.trackDesignRelay.mock.calls.filter(
      ([name]) => name === "design_prompt_submitted",
    );

  it("records one prompt submit with the new design id, after create-design resolves", async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.createDesign.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    let submit: Promise<void> | undefined;
    await act(async () => {
      submit = mocks.promptProps?.onSubmit(
        "A pricing page with three tiers",
        [
          {
            path: "/u/shot.png",
            originalName: "shot.png",
            filename: "shot.png",
            type: "image/png",
            size: 10,
          },
        ],
        {
          contextItems: [
            {
              key: "design-home-reference:figma:FILEKEY:node-1",
              title: "Figma",
              context: "",
            },
          ],
        },
      );
      await Promise.resolve();
    });
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({ id: "design-1", creationMethod: "prompt" }),
    );
    expect(promptEvents()).toHaveLength(0);

    await act(async () => {
      resolveCreate?.();
      await submit;
    });
    expect(promptEvents()).toEqual([
      [
        "design_prompt_submitted",
        {
          output_id: "design-1",
          output_type: "design",
          prompt_source: "composer",
          has_text: true,
          prompt_length_bucket: "1-50",
          reference_types: ["figma", "image"],
          reference_count: 2,
          start_mode: "design",
        },
      ],
    ]);
    expect(JSON.stringify(promptEvents())).not.toContain("pricing");
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-1");
  });

  it("does not record a prompt submit when create-design fails", async () => {
    mocks.createDesign.mockRejectedValueOnce(new Error("database unavailable"));
    await act(async () => {
      await expect(
        mocks.promptProps?.onSubmit("New design", [], {}),
      ).rejects.toThrow("database unavailable");
    });
    expect(promptEvents()).toHaveLength(0);
  });

  it("records a home suggestion click and submits it with its own source", async () => {
    mocks.createDesign.mockResolvedValue(undefined);
    mocks.submitWithText.mockImplementationOnce(async (text: string) => {
      await mocks.promptProps?.onSubmit(text, [], {});
      return true;
    });
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[data-agent-suggestion-position="1"]',
    );
    await act(async () => suggestion?.click());
    expect(promptEvents()).toHaveLength(1);
    expect(promptEvents()[0][1]).toMatchObject({
      prompt_source: "home_suggestion",
      output_id: "design-1",
    });
    expect(mocks.homeSuggestionEvent).toHaveBeenCalledWith(
      "home_suggestion_clicked",
      expect.objectContaining({
        app_id: "design",
        role: "design",
        suggestion_id: expect.stringMatching(/^design-suggestion-/),
        position: 1,
      }),
    );
  });

  it("records a template prompt with the copied design id", async () => {
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });
    await act(async () => {
      await mocks.promptProps?.onSubmit("Make it blue", [], {});
    });
    expect(promptEvents()).toHaveLength(1);
    expect(promptEvents()[0][1]).toMatchObject({
      output_id: "copied-design",
      start_mode: "template",
      reference_types: expect.arrayContaining(["template"]),
    });
  });

  it("does not record a prompt submit for Skip or Use template", async () => {
    mocks.createDesign.mockResolvedValue(undefined);
    await act(async () => {
      await mocks.promptProps?.onSkip();
    });
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });
    await act(async () => {
      await mocks.promptProps?.onSkip();
    });
    expect(mocks.createFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(promptEvents()).toHaveLength(0);
  });

  it("opens the design even when tracking throws", async () => {
    mocks.createDesign.mockResolvedValue(undefined);
    mocks.trackDesignRelay.mockImplementation(() => {
      throw new Error("analytics down");
    });
    await act(async () => {
      await mocks.promptProps?.onSubmit("New design", [], {});
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-1");
    mocks.trackDesignRelay.mockReset();
  });
});
