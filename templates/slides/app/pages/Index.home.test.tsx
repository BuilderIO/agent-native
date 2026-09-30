// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, MemoryRouter, useMatch } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type PromptPopover from "@/components/editor/PromptDialog";

const systemFlag = vi.hoisted(() => ({ enabled: true, query: vi.fn() }));
const suggestionQuery = vi.hoisted(() => ({
  enabled: undefined as boolean | undefined,
}));
const inactiveHomeQueries = vi.hoisted(() => ({
  workspaceDefaultsEnabled: true,
  templateLibraryEnabled: true,
}));
const toastError = vi.hoisted(() => vi.fn());
const homeImport = vi.hoisted(() => ({ current: null as unknown }));
const promptUploads = vi.hoisted(() => ({
  uploadPromptFiles: vi.fn(),
  cleanupUploadedPromptFiles: vi.fn(),
  formatPromptUploadFailure: vi.fn(
    (_error: unknown, description: string) => description,
  ),
  isPromptUploadNetworkError: vi.fn(
    (error: unknown) =>
      error instanceof TypeError ||
      (error instanceof Error &&
        "code" in error &&
        error.code === "reference_upload_network_failed"),
  ),
  isPromptUploadAuthRequiredError: vi.fn(
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "reference_storage_auth_required",
  ),
  isPromptUploadLimitError: vi.fn(
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "reference_storage_limit_exceeded",
  ),
  isPromptUploadStorageStatusError: vi.fn(
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error.code === "reference_storage_http_failed" ||
        error.code === "reference_storage_contract_failed"),
  ),
}));
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => systemFlag.enabled,
}));
vi.mock("@/lib/prompt-file-uploads", () => promptUploads);
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const {
  useDecks,
  reloadDecks,
  createDeck,
  promptProps,
  referenceProps,
  signedIn,
  agentEngine,
  fetchAgentEngineConfiguredState,
  agentSubmit,
  callAction,
  contextOptions,
  refetchSystems,
  headerActions,
  pageTitle,
  homeSuggestions,
} = vi.hoisted(() => ({
  useDecks: vi.fn(),
  reloadDecks: vi.fn(),
  createDeck: vi.fn(),
  promptProps: vi.fn(),
  referenceProps: vi.fn(),
  signedIn: { value: true },
  agentEngine: { state: "configured", missing: false },
  fetchAgentEngineConfiguredState: vi.fn(),
  agentSubmit: vi.fn(),
  callAction: vi.fn().mockResolvedValue(undefined),
  contextOptions: vi.fn(),
  refetchSystems: vi.fn(),
  headerActions: { current: null as ReactNode | null },
  pageTitle: { current: null as ReactNode | null },
  homeSuggestions: {
    value: [
      {
        id: "suggestion-1",
        label: "Build a pitch",
        prompt: "Create a pitch deck for a new product.",
      },
    ],
  },
}));
const translate = (key: string) =>
  ({
    "home.firstDeckPromptTitle":
      "What kind of presentation should we generate?",
    "home.recent": "Recent",
    "home.fallbackSuggestions.pitch": "Create a product pitch deck",
    "home.fallbackSuggestions.roadmap": "Create a product roadmap",
    "home.fallbackSuggestions.explainer": "Explain a topic in a presentation",
    "home.starters.pitch.label": "Pitch deck",
    "home.starters.pitch.prompt": "Create a pitch deck about ",
    "home.noDecksMatchSearch": "No decks match your search.",
    "home.loadFailed": "Couldn't load your content",
    "home.retry": "Retry",
    "home.importMenu.networkFailed": "Network upload failed.",
    "home.importMenu.notStarted": "Complete sign-in, then retry.",
    "editorToolbar.uploadFailed": "Upload failed",
    "editorToolbar.importFailedDescription":
      "Something went wrong importing this file.",
    "root.searchDecks": "Search decks",
    "templatesPage.title": "Templates",
    "templatesPage.browseAll": "Browse all",
  })[key] ?? key;

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@agent-native/core/client/notifications", () => ({
  NotificationsBell: () => null,
}));
vi.mock("@agent-native/core/client/progress", () => ({ RunsTray: () => null }));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    sendToAgentChat: vi.fn(),
    AgentToggleButton: () => null,
    BuilderSetupCard: ({
      bouncePulse = 0,
      onConnected,
    }: {
      bouncePulse?: number;
      onConnected?: () => void;
    }) => (
      <div data-testid="builder-setup-card" data-bounce-pulse={bouncePulse}>
        <h3>Connect AI</h3>
        <button type="button" onClick={onConnected}>
          Connect Builder.io
        </button>
        <a href="/settings/keys">Custom keys</a>
      </div>
    ),
    useAgentEngineConfigured: () => agentEngine,
    useChatModels: () => ({
      selectedEngine: "builder",
      selectedModel: "gpt-5.6-terra",
      availableModels: [],
      isLoading: false,
    }),
    fetchAgentEngineConfiguredState,
  };
});
vi.mock("@agent-native/toolkit/app/chat/chat/run-recovery", () => ({
  BuilderSetupCard: ({
    bouncePulse = 0,
    onConnected,
  }: {
    bouncePulse?: number;
    onConnected?: () => void;
  }) => (
    <div data-testid="builder-setup-card" data-bounce-pulse={bouncePulse}>
      <h3>Connect AI</h3>
      <button type="button" onClick={onConnected}>
        Connect Builder.io
      </button>
      <a href="/settings/keys">Custom keys</a>
    </div>
  ),
  useAgentEngineConfigured: () => agentEngine,
  useChatModels: () => ({ models: [], isLoading: false, isError: false }),
  fetchAgentEngineConfiguredState,
  useVoiceProviderStatus: () => ({ status: "unavailable" }),
  SIDEBAR_STATE_CHANGE_EVENT: "sidebar-state-change",
  sendToAgentChat: vi.fn(),
  setAgentChatContextItem: vi.fn(),
  requestAgentChatThreadOpen: vi.fn(),
  formatAgentChatContextItemsForPrompt: () => "",
  normalizeAgentComposerReference: vi.fn(),
  BuilderSetupContent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorMessage: (error: Error) => error.message,
  useActionQuery: (
    name: string,
    _args: unknown,
    options?: { enabled?: boolean },
  ) => {
    if (name === "generate-home-suggestions") {
      suggestionQuery.enabled = options?.enabled;
      return {
        data:
          options?.enabled === false
            ? undefined
            : { suggestions: homeSuggestions.value },
        isLoading: false,
        isError: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  getBrowserTabId: () => "home-test",
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
  useSession: () => ({
    session: signedIn.value ? { user: { email: "home@example.test" } } : null,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/onboarding", () => ({
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT: "onboarding-status",
  fetchFirstRunOnboardingStatus: vi.fn().mockResolvedValue({ firstRun: false }),
  isFirstRunOnboardingEnabled: () => false,
}));
vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: () => "/sign-in",
}));
vi.mock("@agent-native/toolkit/app-shell", async (importOriginal) => {
  const { useEffect } = await import("react");
  const appShell =
    await importOriginal<typeof import("@agent-native/toolkit/app-shell")>();
  return {
    ...appShell,
    useHeaderActions: () => headerActions.current,
    useHeaderTitle: () => pageTitle.current,
    useSetHeaderActions: (actions: ReactNode) => {
      useEffect(() => {
        headerActions.current = actions;
        return () => {
          headerActions.current = null;
        };
      }, [actions]);
    },
    useSetPageTitle: (title: ReactNode) => {
      useEffect(() => {
        pageTitle.current = title;
        return () => {
          pageTitle.current = null;
        };
      }, [title]);
    },
  };
});
vi.mock("@/context/DeckContext", () => ({
  useDecks,
  describeDeckPersistenceFailure: vi.fn(),
  deckIdFromPathname: vi.fn(),
}));
vi.mock("@/components/templates/DeckTemplateLibrary", () => ({
  DeckTemplateLibrary: ({ enabled }: { enabled?: boolean }) => {
    inactiveHomeQueries.templateLibraryEnabled = enabled ?? true;
    return <div>Starter template library</div>;
  },
}));
vi.mock("@/hooks/use-agent-generating", () => ({
  useAgentGenerating: () => ({
    generating: false,
    submitAndConfirm: agentSubmit,
  }),
  clearStartedGenerationAttempt: vi.fn(),
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: (enabled: boolean) => (
    systemFlag.query(enabled),
    { designSystems: [], refetch: refetchSystems }
  ),
  BuilderSetupContent: () => null,
}));
vi.mock("@/hooks/use-workspace-defaults", () => ({
  useWorkspaceDefaults: (enabled = true) => {
    inactiveHomeQueries.workspaceDefaultsEnabled = enabled;
    return { refetch: vi.fn() };
  },
}));
vi.mock("@/components/editor/SlidesComposerContext", () => ({
  useSlidesComposerContext: (options: unknown) => {
    contextOptions(options);
    return {
      props: { contextItems: [], contextMenuItems: [] },
      beforeSend: vi.fn(),
      dialogs: null,
    };
  },
}));
vi.mock("@/components/design-system/DesignSystemSetup", () => ({
  DesignSystemSetup: ({
    onClose,
    onComplete,
  }: {
    onClose: () => void;
    onComplete: () => void;
  }) =>
    createPortal(
      <div role="dialog" aria-label="Existing system setup">
        <button onClick={onClose}>Cancel setup</button>
        <button onClick={onComplete}>Complete setup</button>
      </div>,
      document.body,
    ),
}));
vi.mock("@/components/deck/DeckCard", () => ({
  default: ({ deck }: { deck: { title: string } }) => (
    <article>{deck.title}</article>
  ),
}));
vi.mock("@/components/editor/DeckEditorSkeleton", () => ({
  DeckEditorSkeleton: () => null,
}));
vi.mock("@/components/editor/ImportDeckButton", () => ({
  ImportDeckButton: ({ controller }: { controller: unknown }) => {
    homeImport.current = controller;
    return (
      <div>
        <button
          onClick={(event) =>
            event.currentTarget.parentElement
              ?.querySelector<HTMLInputElement>("input")
              ?.click()
          }
        >
          home.importMenu.import
        </button>
        <input aria-label="editorToolbar.importFile" hidden />
      </div>
    );
  },
}));
vi.mock("@/components/editor/NewDeckReferenceStep", () => ({
  NewDeckReferenceStep: (props: unknown) => {
    referenceProps(props);
    return null;
  },
}));
vi.mock("@/components/editor/PromptDialog", () => ({
  default: (props: ComponentProps<typeof PromptPopover>) => {
    promptProps(props);
    if (!props.open) return null;
    return (
      <textarea
        aria-label="Presentation prompt"
        value={props.initialText ?? ""}
        readOnly
        disabled={props.disabled}
      />
    );
  },
}));
vi.mock("@agent-native/toolkit/app/chat/chat/run-recovery", () => ({
  BuilderSetupCard: ({
    bouncePulse = 0,
    onConnected,
  }: {
    bouncePulse?: number;
    onConnected?: () => void;
  }) => (
    <div data-testid="builder-setup-card" data-bounce-pulse={bouncePulse}>
      <h3>Connect AI</h3>
      <button type="button" onClick={onConnected}>
        Connect Builder.io
      </button>
      <a href="/settings/keys">Custom keys</a>
    </div>
  ),
  BuilderSetupContent: () => null,
}));

import { Header } from "@/components/layout/Header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { deckIdFromPathname } from "@/context/DeckContext";
import { IMPORT_ACTION_TIMEOUT_MS } from "@/lib/import-uploaded-deck";

import Index from "./Index";

function ActiveIndex() {
  return <Index active={useMatch("/home") !== null} />;
}

const ownDeck = {
  id: "own",
  title: "My presentation",
  createdByMe: true,
  updatedAt: "2026-09-25T00:00:00Z",
};
const sharedDeck = {
  id: "shared",
  title: "Shared presentation",
  createdByMe: false,
  updatedAt: "2026-09-24T00:00:00Z",
};

function renderHome(
  overrides: Record<string, unknown> = {},
  state?: unknown,
  pathname = "/home",
) {
  useDecks.mockReturnValue({
    decks: [],
    loading: false,
    loadError: false,
    reloadDecks,
    createDeck,
    catchUpStaleDeckList: vi.fn(),
    ...overrides,
  });
  const home = () => (
    <MemoryRouter initialEntries={[{ pathname, state }]}>
      <nav>
        <Link to="/templates">Open templates</Link>
        <Link to="/home">Back home</Link>
      </nav>
      <TooltipProvider>
        <ActiveIndex />
      </TooltipProvider>
    </MemoryRouter>
  );
  const result = render(home());
  return { ...result, rerenderHome: () => result.rerender(home()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deckIdFromPathname).mockReset();
  agentSubmit.mockReset().mockResolvedValue({ delivered: true });
  systemFlag.enabled = true;
  suggestionQuery.enabled = undefined;
  inactiveHomeQueries.workspaceDefaultsEnabled = true;
  inactiveHomeQueries.templateLibraryEnabled = true;
  homeImport.current = null;
  createDeck.mockReset();
  signedIn.value = true;
  agentEngine.state = "configured";
  agentEngine.missing = false;
  fetchAgentEngineConfiguredState.mockImplementation(async () =>
    agentEngine.state === "unknown" ? "unavailable" : agentEngine.state,
  );
  homeSuggestions.value = [
    {
      id: "suggestion-1",
      label: "Build a pitch",
      prompt: "Create a pitch deck for a new product.",
    },
  ];
  headerActions.current = null;
  pageTitle.current = null;
  promptUploads.uploadPromptFiles.mockReset();
  promptUploads.cleanupUploadedPromptFiles.mockReset();
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Slides prompt-led home", () => {
  it("renders the home chatfield immediately without a loading skeleton", () => {
    renderHome();

    expect(
      screen.getByRole("textbox", { name: "Presentation prompt" }),
    ).toBeTruthy();
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: "inline",
        disabled: false,
      }),
    );
    expect(
      document.querySelector('[aria-busy="true"].skeleton-shimmer'),
    ).toBeNull();
  });

  it("does not restore home header state while the mounted page is away from home", () => {
    const { rerenderHome } = renderHome();
    expect(headerActions.current).not.toBeNull();
    expect(pageTitle.current).toBe("home.decksTitle");

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));
    expect(headerActions.current).toBeNull();
    expect(pageTitle.current).toBeNull();

    rerenderHome();
    expect(headerActions.current).toBeNull();
    expect(pageTitle.current).toBeNull();
  });

  it("sets home chrome when the route has a trailing slash", () => {
    renderHome({}, undefined, "/HOME/");

    expect(headerActions.current).not.toBeNull();
    expect(pageTitle.current).toBe("home.decksTitle");
  });

  it("does not query or apply a system default or open new setup while disabled", async () => {
    systemFlag.enabled = false;
    renderHome();
    expect(systemFlag.query).toHaveBeenLastCalledWith(false);
    expect(contextOptions.mock.lastCall![0].defaultDesignSystemId).toBeNull();
    await act(async () =>
      contextOptions.mock.lastCall![0].onCreateDesignSystem(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Existing system setup" }),
    ).toBeNull();
  });
  it("opens the existing creator only on selection, keeps the composer mounted on cancel, and refetches on completion", async () => {
    renderHome();
    const composer = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect(
      screen.queryByRole("dialog", { name: "Existing system setup" }),
    ).toBeNull();
    await act(async () =>
      contextOptions.mock.lastCall![0].onCreateDesignSystem(),
    );
    await screen.findByRole("dialog", { name: "Existing system setup" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));
    expect(
      screen.queryByRole("dialog", { name: "Existing system setup" }),
    ).toBeNull();
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      composer,
    );
    expect(refetchSystems).not.toHaveBeenCalled();
    await act(async () =>
      contextOptions.mock.lastCall![0].onCreateDesignSystem(),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Complete setup" }),
    );
    expect(refetchSystems).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      composer,
    );
  });
  it("closes Home dialogs when the route becomes inactive and keeps the composer mounted", async () => {
    renderHome();
    const composer = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    await act(async () =>
      contextOptions.mock.lastCall![0].onCreateDesignSystem(),
    );
    await screen.findByRole("dialog", { name: "Existing system setup" });

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Existing system setup" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      composer,
    );

    fireEvent.click(screen.getByRole("link", { name: "Back home" }));
    expect(
      screen.queryByRole("dialog", { name: "Existing system setup" }),
    ).toBeNull();
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      composer,
    );
  });
  it("sends the direct-start payload through existing persisted deck generation and chat", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const commit = vi.fn();
    const composerContext = {
      designSystemId: null,
      references: [
        {
          source: "slides" as const,
          id: "reference-deck",
          title: "Reference deck",
        },
      ],
    };
    const contextItems = [
      {
        key: "slides:reference-deck:",
        title: "Reference deck",
        context: "A restrained visual style",
        status: "ready" as const,
      },
    ];
    const options = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
      slidesContext: composerContext,
      contextItems,
    };
    await act(async () => {
      promptProps.mock.lastCall![0].onSubmit(
        "Turn meeting notes into a presentation",
        [],
        {
          commit,
          discard: vi.fn(),
          attachments: [],
          context: "Private meeting notes from the source picker",
        },
        options,
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(agentSubmit.mock.calls[0][0]).not.toContain("Private meeting notes");
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "Private meeting notes from the source picker",
    );
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "Do not restore a workspace default",
    );
    expect(agentSubmit.mock.calls[0][1]).toContain("A restrained visual style");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      model: "test-model",
      effort: "high",
    });
    expect(callAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: {
              generationContext: expect.objectContaining({
                additionalContext:
                  "Private meeting notes from the source picker",
                composerContext,
                contextItems,
              }),
            },
          }),
        ],
      }),
    );
    expect(commit).toHaveBeenCalledOnce();
  });

  it("keeps composer references through a setup failure and retry", async () => {
    const composerContext = {
      designSystemId: null,
      references: [
        {
          source: "slides" as const,
          id: "reference-deck",
          title: "Reference deck",
        },
      ],
    };
    const contextItems = [
      {
        key: "slides:reference-deck:",
        title: "Reference deck",
        context: "A restrained visual style",
        status: "ready" as const,
      },
    ];
    const ensureDeckPersisted = vi
      .fn()
      .mockResolvedValueOnce({ persisted: false })
      .mockResolvedValue({ persisted: true });
    createDeck.mockReturnValue({ id: "new-deck" });
    vi.mocked(deckIdFromPathname).mockReturnValue("new-deck");
    renderHome({ ensureDeckPersisted, deleteDeck: vi.fn() });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };
    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        "Create a reference deck",
        [],
        attachments,
        { slidesContext: composerContext, contextItems },
      );
    });
    await waitFor(() => expect(promptProps.mock.lastCall![0].open).toBe(true));
    expect(screen.queryByTestId("new-deck-loading")).toBeNull();

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        "Create a reference deck",
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(agentSubmit.mock.calls[0][1]).toContain("A restrained visual style");
    expect(callAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: {
              generationContext: expect.objectContaining({
                composerContext,
                contextItems,
              }),
            },
          }),
        ],
      }),
    );
  });

  it("preselects a prompt deck link and keeps composer references on Continue", async () => {
    localStorage.setItem(
      "slides:recent-references",
      JSON.stringify([{ id: "shared", kind: "deck", lastUsedAt: 1 }]),
    );
    createDeck.mockReturnValue({ id: "new-deck" });
    const composerContext = {
      designSystemId: null,
      references: [
        {
          source: "website" as const,
          id: "https://example.com",
          title: "Example",
          url: "https://example.com",
        },
      ],
    };
    const contextItems = [
      {
        key: "website:https://example.com:",
        title: "Example",
        context: "Reference page styling",
        status: "ready" as const,
      },
    ];
    const chatAttachment = {
      type: "file" as const,
      name: "notes.txt",
      contentType: "text/plain",
      displayOnly: true as const,
      text: "Keep the notes attached.",
    };
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
    };
    renderHome({
      decks: [ownDeck, sharedDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    await waitFor(() =>
      expect(contextOptions.mock.lastCall![0].defaultReferenceDeck?.id).toBe(
        "shared",
      ),
    );
    const attachments = {
      commit: vi.fn(),
      discard: vi.fn(),
      attachments: [chatAttachment],
    };
    const prompt = `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`;

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(prompt, [], attachments, {
        ...modelSelection,
        slidesContext: composerContext,
        contextItems,
      });
    });

    const referenceStep = referenceProps.mock.lastCall![0] as {
      defaultReferenceDeckId: string | null;
      onSelect: (selection: {
        designSystemId: string | null;
        referenceDeckId: string | null;
      }) => Promise<void>;
      open: boolean;
    };
    expect(referenceStep.open).toBe(true);
    expect(referenceStep.defaultReferenceDeckId).toBe("own");

    await act(async () =>
      referenceStep.onSelect({
        designSystemId: null,
        referenceDeckId: "shared",
      }),
    );
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(agentSubmit.mock.calls[0][1]).toContain("Reference page styling");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      attachments: [chatAttachment],
      model: modelSelection.model,
      engine: modelSelection.engine,
      effort: modelSelection.effort,
    });
    expect(callAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: {
              generationContext: expect.objectContaining({
                referenceDeckId: "shared",
                composerContext,
                contextItems,
              }),
            },
          }),
        ],
      }),
    );
    expect(attachments.commit).toHaveBeenCalledOnce();
  });

  it("keeps composer references when Skip clears an inferred deck reference", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    const composerContext = {
      designSystemId: "ds-explicit",
      references: [
        {
          source: "website" as const,
          id: "https://example.com",
          title: "Example",
          url: "https://example.com",
        },
      ],
    };
    const contextItems = [
      {
        key: "system:ds-explicit",
        title: "Brand system",
        context: "Brand tokens",
        status: "ready" as const,
      },
      {
        key: "website:https://example.com:",
        title: "Example",
        context: "Reference page styling",
        status: "ready" as const,
      },
    ];
    const chatAttachment = {
      type: "file" as const,
      name: "notes.txt",
      contentType: "text/plain",
      displayOnly: true as const,
      text: "Keep the notes attached.",
    };
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
    };
    renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = {
      commit: vi.fn(),
      discard: vi.fn(),
      attachments: [chatAttachment],
    };
    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        attachments,
        { ...modelSelection, slidesContext: composerContext, contextItems },
      );
    });

    const referenceStep = referenceProps.mock.lastCall![0] as {
      defaultDesignSystemId: string | null;
      defaultReferenceDeckId: string | null;
      onSkip: () => Promise<void>;
      open: boolean;
    };
    expect(referenceStep.open).toBe(true);
    expect(referenceStep.defaultDesignSystemId).toBe("ds-explicit");
    expect(referenceStep.defaultReferenceDeckId).toBe("own");

    await act(async () => referenceStep.onSkip());
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(agentSubmit.mock.calls[0][1]).toContain("Brand tokens");
    expect(agentSubmit.mock.calls[0][1]).toContain("Reference page styling");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      attachments: [chatAttachment],
      model: modelSelection.model,
      engine: modelSelection.engine,
      effort: modelSelection.effort,
    });
    expect(callAction).not.toHaveBeenCalledWith(
      "get-deck-reference-context",
      expect.anything(),
      expect.anything(),
    );
    expect(callAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: {
              generationContext: expect.objectContaining({
                designSystemId: "ds-explicit",
                referenceDeckId: null,
                composerContext,
                contextItems,
              }),
            },
          }),
        ],
      }),
    );
    expect(attachments.commit).toHaveBeenCalledOnce();
  });

  it("lets an explicit composer deck reference win over a prompt link", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    const composerContext = {
      designSystemId: null,
      references: [
        { source: "slides" as const, id: "shared", title: "Shared deck" },
      ],
    };
    const contextItems = [
      {
        key: "slides:shared:",
        title: "Shared deck",
        context: "Explicit composer deck reference",
        status: "ready" as const,
      },
    ];
    renderHome({
      decks: [ownDeck, sharedDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
        { slidesContext: composerContext, contextItems },
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(referenceProps.mock.lastCall![0].open).toBe(false);
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "Explicit composer deck reference",
    );
    expect(callAction).not.toHaveBeenCalledWith(
      "get-deck-reference-context",
      expect.anything(),
      expect.anything(),
    );
    expect(callAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: {
              generationContext: expect.objectContaining({
                referenceDeckId: null,
                composerContext,
                contextItems,
              }),
            },
          }),
        ],
      }),
    );
  });

  it("opens the file picker without a provider and preserves the mounted composer after cancel", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    renderHome();
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    const picker = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole("button", { name: "home.importMenu.import" }),
    );
    expect(picker).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("editorToolbar.importFile"), {
      target: { files: [] },
    });
    picker.mockRestore();
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      prompt,
    );
    expect(promptProps.mock.lastCall![0].disabled).toBe(false);
    expect(promptProps.mock.lastCall![0].submissionDisabled).toBeUndefined();
    expect(createDeck).not.toHaveBeenCalled();
  });
  it("uses the shared Builder setup card and keeps the composer interactive", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    const missing = renderHome();
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect(screen.getByRole("heading", { name: "Connect AI" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Builder.io" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Custom keys" }).getAttribute("href"),
    ).toBe("/settings/keys");
    expect((prompt as HTMLTextAreaElement).disabled).toBe(false);
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        showModelSelector: false,
        modelStatusChecksEnabled: false,
        onBeforeSubmit: expect.any(Function),
        onSkip: expect.any(Function),
      }),
    );
    fireEvent.pointerDown(
      document.querySelector("[data-slides-home-composer]")!,
      { button: 0, ctrlKey: false },
    );
    expect(
      screen
        .getByTestId("builder-setup-card")
        .getAttribute("data-bounce-pulse"),
    ).toBe("1");

    const attachments = {
      commit: vi.fn(),
      discard: vi.fn(),
      attachments: [],
    };
    let submitResult: unknown;
    await act(async () => {
      submitResult = await promptProps.mock.lastCall![0].onSubmit(
        "Build a presentation",
        [],
        attachments,
      );
    });
    expect(submitResult).toBe("retain");
    expect(agentSubmit).not.toHaveBeenCalled();
    expect(createDeck).not.toHaveBeenCalled();

    missing.unmount();
    agentEngine.state = "configured";
    agentEngine.missing = false;
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.queryByTestId("builder-setup-card")).toBeNull();
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        showModelSelector: true,
        modelStatusChecksEnabled: true,
      }),
    );
  });

  it("keeps the composer interactive while checking and offers retry if status is unavailable", async () => {
    agentEngine.state = "unknown";
    agentEngine.missing = false;
    renderHome();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Presentation prompt",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(false);
    expect(promptProps.mock.lastCall![0].disabled).toBe(false);
    expect(promptProps.mock.lastCall![0].onBeforeSubmit).toEqual(
      expect.any(Function),
    );
    let canSubmit = true;
    await act(async () => {
      canSubmit = await promptProps.mock.lastCall![0].onBeforeSubmit();
    });
    expect(canSubmit).toBe(false);
    expect(screen.getByRole("status").textContent).toContain(
      "providerStatusUnavailable",
    );

    cleanup();
    agentEngine.state = "unavailable";
    renderHome();
    const dispatch = vi.spyOn(window, "dispatchEvent");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-engine:configured-changed" }),
    );
  });

  it("keeps the setup card visible when a preflight fails after missing status is known", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    renderHome();
    expect(screen.getByRole("heading", { name: "Connect AI" })).toBeTruthy();
    fetchAgentEngineConfiguredState.mockRejectedValueOnce(
      new Error("temporary failure"),
    );

    let canSubmit = true;
    await act(async () => {
      canSubmit = await promptProps.mock.lastCall![0].onBeforeSubmit();
    });

    expect(canSubmit).toBe(false);
    expect(screen.getByRole("heading", { name: "Connect AI" })).toBeTruthy();
    expect(screen.queryByText("providerStatusUnavailable")).toBeNull();
  });

  it("ignores a stale readiness check after the provider hook reports configured", async () => {
    agentEngine.state = "unknown";
    agentEngine.missing = false;
    const home = renderHome();
    let resolveStatus: (state: "missing") => void = () => {};
    fetchAgentEngineConfiguredState.mockReturnValueOnce(
      new Promise<"missing">((resolve) => {
        resolveStatus = resolve;
      }),
    );
    let preflight = Promise.resolve(false);
    await act(async () => {
      preflight = promptProps.mock.lastCall![0].onBeforeSubmit();
    });

    agentEngine.state = "configured";
    await act(async () => home.rerenderHome());
    await act(async () => resolveStatus("missing"));

    expect(await preflight).toBe(true);
    expect(screen.queryByTestId("builder-setup-card")).toBeNull();
  });

  it("preserves an explicit Templates choice made while decks are loading", async () => {
    const home = renderHome({ loading: true });
    const templates = screen.getByRole("tab", { name: "Templates" });
    fireEvent.click(templates);

    useDecks.mockReturnValue({
      decks: [ownDeck],
      loading: false,
      loadError: false,
      reloadDecks,
      createDeck,
      catchUpStaleDeckList: vi.fn(),
    });
    await act(async () => home.rerenderHome());

    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps the composer as the focal point and shows both library tabs without accessible work", async () => {
    renderHome({ decks: [] });
    expect(
      screen.getByRole("heading", {
        name: "What kind of presentation should we generate?",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("textbox", { name: "Presentation prompt" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy();
    const mountedHeader = render(
      <MemoryRouter initialEntries={["/home"]}>
        <Header />
      </MemoryRouter>,
    );
    const search = within(mountedHeader.container).getByRole("searchbox", {
      name: "Search decks",
    });
    Object.defineProperty(search, "getClientRects", {
      value: () => [{ width: 100, height: 32 }],
    });
    for (const candidate of document.querySelectorAll<HTMLInputElement>(
      "[data-home-search]",
    )) {
      if (candidate === search) continue;
      Object.defineProperty(candidate, "getClientRects", { value: () => [] });
    }
    const slash = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(slash);
    expect(slash.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search);
    mountedHeader.unmount();
    expect(
      screen.getByRole("link", { name: /browse all/i }).getAttribute("href"),
    ).toBe("/templates");
    expect(screen.getByText("Starter template library")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new deck/i })).toBeNull();
  });

  it("shows the Recent tab for shared-only accessible decks", async () => {
    renderHome({ decks: [sharedDeck] });
    expect(await screen.findByRole("tab", { name: "Recent" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Templates" })).toBeTruthy();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
  });

  it("keeps the recent panel available while searching a shared-only home", async () => {
    renderHome({ decks: [sharedDeck] });
    const header = render(
      (headerActions.current as ReactElement<{ search: ReactNode }>).props
        .search,
    );
    fireEvent.change(
      header.getAllByRole("searchbox", { name: "Search decks" })[0]!,
      { target: { value: "shared" } },
    );
    expect(
      await screen.findByRole("tabpanel", { name: "Recent" }),
    ).toBeTruthy();
    expect(screen.getByText("Shared presentation")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Templates" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("tabpanel", { name: "Templates" })).toBeTruthy();
    header.unmount();
  });

  it("defaults to recents when the unfiltered owned collection has content", async () => {
    renderHome({ decks: [ownDeck, sharedDeck] });
    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("tabpanel", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("My presentation")).toBeTruthy();
    expect(screen.queryByText("Shared presentation")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search decks" }), {
      target: { value: "no match" },
    });
    expect(screen.getByRole("tabpanel", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("No decks match your search.")).toBeTruthy();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
  });

  it("does not treat a pending read or failed read as successful owned work", async () => {
    const loading = renderHome({ decks: [ownDeck], loading: true });
    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    loading.unmount();
    renderHome({ decks: [], loadError: true });
    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load your content",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reloadDecks).toHaveBeenCalledOnce();
  });

  it("keeps the last successful owned collection visible after a failed background refresh", async () => {
    const home = renderHome({ decks: [ownDeck, sharedDeck] });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Recent" }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.getByText("My presentation")).toBeTruthy();
    useDecks.mockReturnValue({ ...useDecks(), loadError: true });
    home.rerenderHome();
    expect(screen.getByRole("tabpanel", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("My presentation")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your content")).toBeNull();
  });

  it("submits a generated quick action without replacing the composer", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const prompt = screen.getByRole("textbox", { name: "Presentation prompt" });
    fireEvent.click(screen.getByRole("button", { name: "Build a pitch" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      prompt,
    );
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: "inline",
        draftScope: "slides-new-deck",
      }),
    );
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("pauses home suggestions while the retained Home route is inactive", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(suggestionQuery.enabled).toBe(true);
    expect(systemFlag.query).toHaveBeenLastCalledWith(true);
    expect(inactiveHomeQueries.workspaceDefaultsEnabled).toBe(true);
    expect(inactiveHomeQueries.templateLibraryEnabled).toBe(true);
    expect(promptProps.mock.lastCall![0].active).toBe(true);

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));

    await waitFor(() =>
      expect(promptProps.mock.lastCall![0].disabled).toBe(true),
    );
    await waitFor(() => expect(suggestionQuery.enabled).toBe(false));
    expect(systemFlag.query).toHaveBeenLastCalledWith(false);
    expect(inactiveHomeQueries.workspaceDefaultsEnabled).toBe(false);
    expect(inactiveHomeQueries.templateLibraryEnabled).toBe(false);
    expect(promptProps.mock.lastCall![0].active).toBe(false);

    fireEvent.click(screen.getByRole("link", { name: "Back home" }));
    await waitFor(() => expect(suggestionQuery.enabled).toBe(true));
    expect(systemFlag.query).toHaveBeenLastCalledWith(true);
    expect(inactiveHomeQueries.workspaceDefaultsEnabled).toBe(true);
    expect(inactiveHomeQueries.templateLibraryEnabled).toBe(true);
    expect(promptProps.mock.lastCall![0].active).toBe(true);
  });

  it("preserves the pending reference step across template navigation", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };
    await act(async () => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      expect(
        await props.onSubmit("My outline", [], attachments, {
          model: "test-model",
          engine: "builder",
          effort: "high",
        }),
      ).toBe("retain");
    });
    expect(promptProps.mock.lastCall![0].open).toBe(false);
    expect(referenceProps.mock.lastCall![0].open).toBe(true);

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));
    await waitFor(() =>
      expect(referenceProps.mock.lastCall![0].open).toBe(false),
    );

    fireEvent.click(screen.getByRole("link", { name: "Back home" }));
    await waitFor(() =>
      expect(referenceProps.mock.lastCall![0].open).toBe(true),
    );
    expect(attachments.discard).not.toHaveBeenCalled();
  });

  it("falls back to prompts that can create a new presentation", async () => {
    homeSuggestions.value = [];
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    expect(
      screen.getByRole("button", { name: "Create a product pitch deck" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create a product roadmap" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Explain a topic in a presentation",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Apply our brand to this deck")).toBeNull();
  });

  it.each([
    { state: "missing", missing: true, ready: false },
    { state: "unknown", missing: false, ready: false },
    { state: "unavailable", missing: false, ready: false },
    { state: "configured", missing: false, ready: true },
    { state: "configured", missing: true, ready: false },
  ])(
    "gates model controls and suggestions while keeping the prompt path available for $state (missing=$missing)",
    async ({ state, missing, ready }) => {
      agentEngine.state = state;
      agentEngine.missing = missing;
      renderHome();
      await screen.findByRole("textbox", { name: "Presentation prompt" });
      expect(promptProps.mock.lastCall![0]).toMatchObject({
        disabled: false,
        showModelSelector: ready,
        modelStatusChecksEnabled: ready,
        onBeforeSubmit: expect.any(Function),
      });
      expect(promptProps.mock.lastCall![0].submissionDisabled).toBeUndefined();
      expect(Boolean(screen.queryByLabelText("home.suggestedPrompts"))).toBe(
        ready,
      );
      expect(
        Boolean(screen.queryByRole("button", { name: "Build a pitch" })),
      ).toBe(ready);
      expect(
        screen.queryByRole("button", { name: "Create a product pitch deck" }),
      ).toBeNull();
      expect(suggestionQuery.enabled).toBe(ready);
    },
  );

  it("restores the full pending generation when reference selection is canceled", async () => {
    const uploadedFile = {
      path: "/uploads/source.pptx",
      originalName: "source.pptx",
      filename: "source.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 32,
    };
    const chatAttachment = {
      type: "file" as const,
      name: "notes.txt",
      contentType: "text/plain",
      displayOnly: true as const,
      text: "Keep these notes attached.",
    };
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
    };
    createDeck.mockReturnValue({ id: "new-deck" });
    renderHome(
      {
        decks: [
          {
            id: "reference-deck",
            title: "Reference deck",
            createdByMe: true,
          },
        ],
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
      },
      {
        retryPrompt: "Create a roadmap",
        retryFiles: [uploadedFile],
        retryReferenceFilePaths: [uploadedFile.path],
        retryImportedReference: {
          deckId: "reference-deck",
          filePath: uploadedFile.path,
        },
        retryContext: "Saved source context",
        retryAttachments: [chatAttachment],
        modelSelection,
      },
    );
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    await waitFor(() =>
      expect(promptProps.mock.lastCall![0].initialText).toBe(
        "Create a roadmap",
      ),
    );
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };
    await act(async () => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      expect(await props.onSubmit("Create a roadmap", [], attachments)).toBe(
        "retain",
      );
    });
    expect(
      screen.queryByRole("textbox", { name: "Presentation prompt" }),
    ).toBeNull();
    expect(attachments.discard).not.toHaveBeenCalled();
    act(() => referenceProps.mock.lastCall![0].onOpenChange(false));
    expect(promptProps.mock.lastCall![0].open).toBe(true);
    expect(promptProps.mock.lastCall![0].initialModelSelection).toEqual(
      modelSelection,
    );
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "Presentation prompt",
        })) as HTMLTextAreaElement
      ).value,
    ).toBe("Create a roadmap");
    expect(attachments.commit).toHaveBeenCalledOnce();
    expect(attachments.discard).not.toHaveBeenCalled();

    await act(async () => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      expect(
        await props.onSubmit("Create a roadmap", [], {
          commit: vi.fn(),
          discard: vi.fn(),
          attachments: [],
        }),
      ).toBe("retain");
    });
    await act(async () =>
      referenceProps.mock.lastCall![0].onSelect({
        designSystemId: null,
        referenceDeckId: "reference-deck",
      }),
    );

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const [, generationContext, generationOptions] = agentSubmit.mock.calls[0];
    expect(generationContext).toContain("Saved source context");
    expect(generationContext).toContain("source.pptx");
    expect(generationOptions).toMatchObject({
      attachments: [chatAttachment],
      model: modelSelection.model,
      engine: modelSelection.engine,
      effort: modelSelection.effort,
    });
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "reference-deck" },
      { method: "GET" },
    );
    expect(callAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.anything(),
      expect.anything(),
    );
  });

  it("uses generic copy for a storage status failure during reference import", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };
    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        "My outline",
        [],
        attachments,
        {
          model: "test-model",
          engine: "builder",
          effort: "high",
        },
      );
    });
    promptUploads.uploadPromptFiles.mockRejectedValue(
      Object.assign(
        new Error("Reference file storage status could not be verified"),
        {
          code: "reference_storage_http_failed",
        },
      ),
    );

    await act(async () => {
      await referenceProps.mock.lastCall![0].onImport([
        new File(["pdf"], "reference.pdf", { type: "application/pdf" }),
      ]);
    });

    expect(toastError).toHaveBeenCalledWith("Upload failed", {
      description: "Something went wrong importing this file.",
    });
  });

  it("cleans uploaded files when importing the reference deck fails", async () => {
    const uploaded = {
      path: "/uploads/reference.pptx",
      originalName: "reference.pptx",
      filename: "reference.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 4,
    };
    promptUploads.uploadPromptFiles.mockResolvedValue([uploaded]);
    callAction.mockRejectedValueOnce(new Error("Import failed"));
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit("Outline", [], {
        commit: vi.fn(),
        discard: vi.fn(),
        attachments: [],
      });
    });
    await act(async () => {
      await referenceProps.mock.lastCall![0].onImport([
        new File(["pptx"], "reference.pptx"),
      ]);
    });

    expect(promptUploads.cleanupUploadedPromptFiles).toHaveBeenCalledWith([
      uploaded,
    ]);
  });

  it("cleans a direct-import upload when the PPTX import action fails", async () => {
    const uploaded = {
      path: "/uploads/direct.pptx",
      originalName: "direct.pptx",
      filename: "direct.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 4,
    };
    promptUploads.uploadPromptFiles.mockResolvedValue([uploaded]);
    callAction.mockRejectedValueOnce(new Error("Import failed"));
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await (
        homeImport.current as {
          importFile: (file: File, scope: "pptx") => Promise<boolean>;
        }
      ).importFile(new File(["pptx"], "direct.pptx"), "pptx");
    });

    expect(callAction).toHaveBeenCalledWith(
      "import-pptx",
      expect.objectContaining({ filePath: uploaded.path }),
      { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
    );
    expect(promptUploads.cleanupUploadedPromptFiles).toHaveBeenCalledWith([
      uploaded,
    ]);
  });

  it("uses the extended action timeout for direct PDF imports", async () => {
    const uploaded = {
      path: "/uploads/direct.pdf",
      originalName: "direct.pdf",
      filename: "direct.pdf",
      type: "application/pdf",
      size: 4,
    };
    createDeck.mockReturnValue({ id: "direct-deck" });
    promptUploads.uploadPromptFiles.mockResolvedValue([uploaded]);
    callAction.mockResolvedValueOnce({
      imported: true,
      deckId: "direct-deck",
      pageCount: 1,
    });
    renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await (
        homeImport.current as {
          importFile: (file: File, scope: "pdf") => Promise<boolean>;
        }
      ).importFile(
        new File(["pdf"], "direct.pdf", { type: "application/pdf" }),
        "pdf",
      );
    });

    expect(callAction).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({
        filePath: uploaded.path,
        format: "pdf",
        deckId: "direct-deck",
        importIntoDeck: true,
      }),
      { timeoutMs: IMPORT_ACTION_TIMEOUT_MS },
    );
  });

  it("preserves the filename when a direct-import upload needs sign-in", async () => {
    const authError = Object.assign(new Error("Sign-in required"), {
      code: "reference_storage_auth_required",
      fileName: "direct.pptx",
    });
    promptUploads.uploadPromptFiles.mockRejectedValue(authError);
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await (
        homeImport.current as {
          importFile: (file: File, scope: "pptx") => Promise<boolean>;
        }
      ).importFile(new File(["pptx"], "direct.pptx"), "pptx");
    });

    expect(promptUploads.formatPromptUploadFailure).toHaveBeenCalledWith(
      authError,
      "Sign-in required",
    );
    expect((homeImport.current as { error: string }).error).toBe(
      "Sign-in required",
    );
  });

  it("reopens after sign-in cancellation and preserves the auth draft and model", async () => {
    signedIn.value = false;
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
    };
    act(() => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      expect(
        props.onBeforeUpload?.(
          "My saved outline",
          [],
          "Reference context",
          [],
          modelSelection,
        ),
      ).toBe(false);
    });
    expect(
      screen.queryByRole("textbox", { name: "Presentation prompt" }),
    ).toBeNull();
    expect(sessionStorage.getItem("slides:pending-deck-prompt")).toBe(
      "My saved outline",
    );
    fireEvent.click(screen.getByRole("button", { name: "home.cancel" }));
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(promptProps.mock.lastCall![0].initialModelSelection).toEqual(
      modelSelection,
    );
    expect(localStorage.getItem("an-composer-draft:slides-new-deck")).toContain(
      "My saved outline",
    );
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("restores the generation-failure draft and model on the inline home", async () => {
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high",
    };
    renderHome(
      {},
      {
        retryPrompt: "Retry my presentation",
        retryContext: "Source context",
        modelSelection,
      },
    );
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect((prompt as HTMLTextAreaElement).value).toBe("Retry my presentation");
    expect(localStorage.getItem("an-composer-draft:slides-new-deck")).toContain(
      "Retry my presentation",
    );
    expect(promptProps.mock.lastCall![0].initialModelSelection).toEqual(
      modelSelection,
    );
    expect(promptProps.mock.lastCall![0].open).toBe(true);
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("restores the saved sign-in draft and model without automatically generating", async () => {
    signedIn.value = false;
    const home = renderHome();
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect((prompt as HTMLTextAreaElement).value).toBe("");
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high",
    };
    sessionStorage.setItem(
      "slides:pending-deck-prompt",
      "Continue after sign-in",
    );
    sessionStorage.setItem(
      "slides:pending-deck-prompt-context",
      "Reference context",
    );
    sessionStorage.setItem(
      "slides:pending-deck-model-selection",
      JSON.stringify(modelSelection),
    );
    signedIn.value = true;
    home.rerenderHome();
    await waitFor(() =>
      expect((prompt as HTMLTextAreaElement).value).toBe(
        "Continue after sign-in",
      ),
    );
    expect(screen.getByRole("textbox", { name: "Presentation prompt" })).toBe(
      prompt,
    );
    expect(localStorage.getItem("an-composer-draft:slides-new-deck")).toContain(
      "Continue after sign-in",
    );
    expect(promptProps.mock.lastCall![0].initialModelSelection).toEqual(
      modelSelection,
    );
    expect(sessionStorage.getItem("slides:pending-deck-prompt")).toBeNull();
    await act(async () => {
      promptProps.mock.lastCall![0].onSubmit(
        "Continue after sign-in",
        [],
        {
          commit: vi.fn(),
          discard: vi.fn(),
          attachments: [],
          context: "Reference context",
        },
        {
          model: modelSelection.model,
          engine: modelSelection.engine,
          effort: modelSelection.effort,
          slidesContext: { designSystemId: null, references: [] },
          contextItems: [],
        },
      );
    });
    await waitFor(() =>
      expect(referenceProps.mock.lastCall![0].open).toBe(true),
    );
    expect(createDeck).not.toHaveBeenCalled();
    expect(agentSubmit).not.toHaveBeenCalled();
  });
});
