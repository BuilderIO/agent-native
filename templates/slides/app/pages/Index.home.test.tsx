import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
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
import {
  type ComponentProps,
  type ReactNode,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { renderToString } from "react-dom/server";
import { Link, MemoryRouter, useMatch } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type PromptPopover from "@/components/editor/PromptDialog";
import { findPromptReferenceDeckId } from "@/lib/new-deck-reference-selection";

const systemFlag = vi.hoisted(() => ({
  enabled: true,
  status: "ready" as "loading" | "ready" | "unavailable",
  query: vi.fn(),
}));
const suggestionQuery = vi.hoisted(() => ({
  enabled: undefined as boolean | undefined,
  pending: false,
}));
const inactiveHomeQueries = vi.hoisted(() => ({
  workspaceDefaultsEnabled: true,
  templateLibraryEnabled: true,
}));
const defaultDesignSystems = vi.hoisted(() => ({
  systems: [] as Array<{ id: string; title: string }>,
  personal: null as { id: string } | null,
  workspace: null as { id: string; status: string } | null,
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
  useDesignSystemWorkflowsState: () => ({
    status: systemFlag.status,
    enabled: systemFlag.enabled,
  }),
}));
vi.mock("@/lib/prompt-file-uploads", () => promptUploads);
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const {
  useDecks,
  reloadDecks,
  createDeck,
  updateDeck,
  promptProps,
  referenceProps,
  signedIn,
  agentEngine,
  agentSubmit,
  callAction,
  contextOptions,
  contextSelection,
  automaticReferenceDeck,
  refetchSystems,
  headerActions,
  pageTitle,
  homeSuggestions,
  submitDraft,
  getDraftSnapshot,
} = vi.hoisted(() => ({
  submitDraft: vi.fn(async () => true),
  getDraftSnapshot: vi.fn(),
  useDecks: vi.fn(),
  reloadDecks: vi.fn(),
  createDeck: vi.fn(),
  updateDeck: vi.fn(),
  promptProps: vi.fn(),
  referenceProps: vi.fn(),
  signedIn: { value: true, unreachable: false },
  agentEngine: {
    state: "configured",
    missing: false,
    get canChat() {
      return this.state === "configured" && !this.missing;
    },
  },
  agentSubmit: vi.fn(),
  callAction: vi.fn().mockResolvedValue(undefined),
  contextOptions: vi.fn(),
  contextSelection: {
    value: { designSystemId: null, references: [] } as {
      designSystemId: string | null;
      references: Array<{
        source: "slides" | "website";
        id: string;
        title: string;
        url?: string;
      }>;
    },
  },
  automaticReferenceDeck: { value: null as string | null },
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
      {
        id: "suggestion-2",
        label: "Plan a roadmap",
        prompt: "Create a roadmap presentation for a product team.",
      },
      {
        id: "suggestion-3",
        label: "Review the quarter",
        prompt: "Create a clear quarterly business review deck.",
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
vi.mock("@agent-native/toolkit/app/notifications", () => ({
  NotificationsBell: () => null,
}));
vi.mock("@agent-native/toolkit/app/progress", () => ({ RunsTray: () => null }));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/client/agent-chat")
    >();
  return {
    ...actual,
    sendToAgentChat: vi.fn(),
    useAgentEngineConfigured: () => agentEngine,
    useChatModels: () => ({
      selectedEngine: "builder",
      selectedModel: "gpt-5.6-terra",
      availableModels: [],
      isLoading: false,
    }),
  };
});
vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app/chat")>()),
  AgentToggleButton: () => null,
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
      <div data-testid="builder-setup-card" data-bounce-pulse={bouncePulse}>
        <h3>Connect AI</h3>
        <button type="button" onClick={onConnected}>
          Use Builder.io
        </button>
        <a href="/settings/keys">Custom keys</a>
      </div>
    ),
    BuilderSetupContent: () => null,
  }),
);
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
      if (suggestionQuery.pending && options?.enabled !== false) {
        return { data: undefined, isLoading: true, isError: false };
      }
      return {
        data:
          options?.enabled === false
            ? undefined
            : { status: "ready", suggestions: homeSuggestions.value },
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
    status: signedIn.unreachable
      ? "unavailable"
      : signedIn.value
        ? "authenticated"
        : "unauthenticated",
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/onboarding", () => ({
  FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT: "onboarding-status",
  fetchFirstRunOnboardingStatus: vi.fn().mockResolvedValue({ firstRun: false }),
  isFirstRunOnboardingEnabled: () => false,
}));
vi.mock("@agent-native/core/client/sign-in-return", () => ({
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
    {
      designSystems: defaultDesignSystems.systems,
      defaultSystem: defaultDesignSystems.personal,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: refetchSystems,
    }
  ),
  BuilderSetupContent: () => null,
}));
vi.mock("@/hooks/use-workspace-defaults", () => ({
  useWorkspaceDefaults: (enabled = true) => {
    inactiveHomeQueries.workspaceDefaultsEnabled = enabled;
    return { designSystem: defaultDesignSystems.workspace, refetch: vi.fn() };
  },
}));
vi.mock("@/components/editor/SlidesComposerContext", () => ({
  useSlidesComposerContext: (options: unknown) => {
    contextOptions(options);
    return {
      selection: contextSelection.value,
      automaticReferenceDeckId: automaticReferenceDeck.value,
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
  default: function PromptDialogMock(
    props: ComponentProps<typeof PromptPopover>,
  ) {
    promptProps(props);
    useImperativeHandle(props.controllerRef, () => ({
      submitSource: vi.fn(async () => true),
      submitDraft,
      getDraftSnapshot,
    }));
    if (!props.open) return null;
    return (
      <>
        <textarea
          aria-label="Presentation prompt"
          value={props.initialText ?? ""}
          readOnly
          disabled={props.disabled}
        />
      </>
    );
  },
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
    deckListRefreshing: false,
    reloadDecks,
    createDeck,
    updateDeck,
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
  contextSelection.value = { designSystemId: null, references: [] };
  automaticReferenceDeck.value = null;
  systemFlag.enabled = true;
  systemFlag.status = "ready";
  suggestionQuery.enabled = undefined;
  suggestionQuery.pending = false;
  inactiveHomeQueries.workspaceDefaultsEnabled = true;
  inactiveHomeQueries.templateLibraryEnabled = true;
  defaultDesignSystems.systems = [];
  defaultDesignSystems.personal = null;
  defaultDesignSystems.workspace = null;
  homeImport.current = null;
  createDeck.mockReset();
  updateDeck.mockReset();
  signedIn.value = true;
  signedIn.unreachable = false;
  agentEngine.state = "configured";
  agentEngine.missing = false;
  homeSuggestions.value = [
    {
      id: "suggestion-1",
      label: "Build a pitch",
      prompt: "Create a pitch deck for a new product.",
    },
    {
      id: "suggestion-2",
      label: "Plan a roadmap",
      prompt: "Create a roadmap presentation for a product team.",
    },
    {
      id: "suggestion-3",
      label: "Review the quarter",
      prompt: "Create a clear quarterly business review deck.",
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

  it("does not silently add personal or workspace defaults to a new prompt", () => {
    defaultDesignSystems.systems = [
      { id: "builder-official", title: "Builder Official" },
    ];
    defaultDesignSystems.personal = { id: "builder-official" };
    defaultDesignSystems.workspace = {
      id: "builder-official",
      status: "available",
    };

    renderHome();

    expect(contextOptions.mock.lastCall![0].defaultDesignSystemId).toBeNull();
    expect(referenceProps.mock.lastCall![0].defaultDesignSystemId).toBeNull();
  });
  it("waits for a ready design-system flag before treating references as empty", () => {
    systemFlag.enabled = false;
    systemFlag.status = "loading";
    const { rerenderHome } = renderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(false);

    systemFlag.status = "unavailable";
    rerenderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(false);

    systemFlag.status = "ready";
    rerenderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(true);

    useDecks.mockReturnValue({ ...useDecks(), deckListRefreshing: true });
    rerenderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(false);

    useDecks.mockReturnValue({ ...useDecks(), deckListRefreshing: false });
    rerenderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(true);

    useDecks.mockReturnValue({ ...useDecks(), loadError: true });
    rerenderHome();

    expect(referenceProps.mock.lastCall![0].referenceOptionsLoaded).toBe(false);
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
  it("starts an ordinary prompt without opening reference selection", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };

    await act(async () => {
      expect(
        await promptProps.mock.lastCall![0].onSubmit(
          "Create a product overview",
          [],
          attachments,
          {
            slidesContext: { designSystemId: null, references: [] },
            contextItems: [],
          },
        ),
      ).toBe("retain");
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(referenceProps.mock.lastCall![0].open).toBe(false);
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          designSystemId: null,
          referenceDeckId: null,
        }),
      }),
    );
    expect(attachments.commit).toHaveBeenCalledOnce();
  });

  it("includes optional media-search fallback in the submitted agent context", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        "Create a product overview",
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
        {
          slidesContext: { designSystemId: null, references: [] },
          contextItems: [],
        },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const submittedContext = agentSubmit.mock.calls[0][1] as string;
    expect(submittedContext).toContain(
      "Image and logo lookup with search-images or search-logos is optional enrichment.",
    );
    expect(submittedContext).toContain(
      "If a provider is unconfigured or unavailable, the search returns no matches, or the action fails, continue with a useful deck",
    );
    expect(submittedContext).toContain(
      "Do not stop generation or retry the lookup in a loop.",
    );
  });

  it("gives an explicitly selected target system priority over a reference deck's linked system", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    defaultDesignSystems.systems = [{ id: "system-b", title: "System B" }];
    callAction.mockImplementation(async (action: string) => {
      if (action === "get-design-system") {
        return { title: "System B", agentContext: "System B tokens." };
      }
      if (action === "get-deck-reference-context") {
        return {
          designSystemId: "system-a",
          linkedDesignSystemStatus: "available",
          agentContext: [
            "## Reference Deck — Visual Language",
            "### Linked design system (reference default)",
            "System A tokens apply only when no separate target system is selected.",
            "### Patterns",
            "Untrusted sample HTML for composition.",
          ].join("\n"),
        };
      }
      return undefined;
    });
    renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
        {
          slidesContext: { designSystemId: "system-b", references: [] },
          contextItems: [
            {
              key: "system:system-b",
              title: "System B",
              context: "System B tokens.",
              status: "ready" as const,
            },
          ],
        },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const generationContext = agentSubmit.mock.calls[0][1] as string;
    expect(generationContext).toContain(
      "Use design system system-b for visual tokens",
    );
    expect(generationContext).toContain("System B tokens.");
    expect(generationContext).toContain(
      "System A tokens apply only when no separate target system is selected.",
    );
    expect(generationContext).toContain(
      "controls its tokens and slide defaults, overriding styles inferred from references",
    );
    expect(generationContext).toContain(
      "Untrusted sample HTML for composition.",
    );
    expect(generationContext).not.toContain(
      "Follow its measured visual language as the styling source of truth",
    );
  });

  it("uses a reference deck's linked system before measured styling when no target system is selected", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    callAction.mockResolvedValue({
      designSystemId: "system-a",
      linkedDesignSystemStatus: "available",
      agentContext: [
        "## Reference Deck — Visual Language",
        "No separate target system is selected. Linked system A controls tokens and slide defaults.",
        "### Patterns",
        "Untrusted sample HTML for composition.",
      ].join("\n"),
    });
    renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const generationContext = agentSubmit.mock.calls[0][1] as string;
    expect(generationContext).toContain(
      "The reference deck's readable linked design system controls tokens and slide defaults",
    );
    expect(generationContext).toContain(
      "Do not call `get-workspace-defaults` or apply a workspace default",
    );
    expect(generationContext).toContain(
      "Linked system A controls tokens and slide defaults.",
    );
    expect(generationContext).toContain(
      "Untrusted sample HTML for composition.",
    );
    expect(generationContext).not.toContain(
      "Follow its measured visual language as the styling source of truth",
    );
  });

  it("uses measured reference styling when the linked system is unavailable", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    callAction.mockResolvedValue({
      designSystemId: "system-a",
      linkedDesignSystemStatus: "unavailable",
      agentContext: [
        "## Reference Deck — Visual Language",
        "### Linked design system (unavailable)",
        "Use the readable samples' measured visual language as fallback.",
        "### Patterns",
        "Untrusted sample HTML for composition.",
      ].join("\n"),
    });
    renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const generationContext = agentSubmit.mock.calls[0][1] as string;
    expect(generationContext).toContain(
      "No target or readable linked design system was selected. Because the reference deck was read successfully, use its measured visual language",
    );
    expect(generationContext).not.toContain(
      "The reference deck's readable linked design system controls tokens",
    );
  });

  it("does not infer reference styling when the reference deck failed to load", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    callAction.mockImplementation(async (action: string) => {
      if (action === "get-deck-reference-context") {
        throw new Error("temporary reference read failure");
      }
      return undefined;
    });
    renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        `Use this as a style reference: ${window.location.origin}/deck/own?slide=7`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    const generationContext = agentSubmit.mock.calls[0][1] as string;
    expect(generationContext).toContain(
      "The selected reference deck could not be read, so its linked-system status and measured visual language are unknown",
    );
    expect(generationContext).toContain(
      "stop instead of generating with an assumed style",
    );
    expect(generationContext).not.toContain(
      "Because the reference deck was read successfully, use its measured visual language",
    );
  });

  it("explains an unreadable attachment instead of showing the raw send-failure code", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    agentSubmit.mockResolvedValueOnce({
      delivered: false,
      reason: "attachment-unreadable",
    });
    renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      promptProps.mock.lastCall![0].onSubmit("Summarize my notes", [], {
        commit: vi.fn(),
        discard: vi.fn(),
        attachments: [],
      });
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const description = toastError.mock.lastCall?.[1]?.description;
    expect(description).not.toBe("attachment-unreadable");
    // The test catalog may echo the key; either way it is the attachment copy.
    expect(description).toMatch(/uploadAttachedFailed|attached file/i);
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
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "For a requested slide count, compare the slideCount returned by every add-slide result",
    );
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "If add-slide returns errorCode target_slide_count_reached, re-read get-deck once",
    );
    expect(agentSubmit.mock.calls[0][1]).toContain("A restrained visual style");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      model: "test-model",
      effort: "high",
    });
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          additionalContext: "Private meeting notes from the source picker",
          composerContext,
          contextItems,
        }),
      }),
    );
    const acceptedEvent = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === "generation_request_accepted");
    expect(acceptedEvent).toBeDefined();
    const acceptedTiming = acceptedEvent?.[1];
    expect(acceptedTiming).toMatchObject({
      started_at_ms: expect.any(Number),
      ended_at_ms: expect.any(Number),
      duration_ms: expect.any(Number),
    });
    expect(acceptedTiming?.ended_at_ms).toBeGreaterThanOrEqual(
      acceptedTiming?.started_at_ms as number,
    );
    expect(acceptedTiming?.duration_ms).toBe(
      (acceptedTiming?.ended_at_ms as number) -
        (acceptedTiming?.started_at_ms as number),
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
    const updatedComposerContext = {
      designSystemId: null,
      references: [
        {
          source: "website" as const,
          id: "https://example.com/new-style",
          title: "Updated style reference",
          url: "https://example.com/new-style",
        },
      ],
    };
    const updatedContextItems = [
      {
        key: "website:https://example.com/new-style:",
        title: "Updated style reference",
        context: "A crisp editorial style",
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
        {
          slidesContext: updatedComposerContext,
          contextItems: updatedContextItems,
        },
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(agentSubmit.mock.calls[0][1]).toContain("A crisp editorial style");
    expect(agentSubmit.mock.calls[0][1]).not.toContain(
      "A restrained visual style",
    );
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          composerContext: updatedComposerContext,
          contextItems: updatedContextItems,
        }),
      }),
    );
  });

  it("starts from a prompt deck link and keeps other composer references", async () => {
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
    expect(contextOptions.mock.lastCall![0]).not.toHaveProperty(
      "defaultReferenceDeck",
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

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(referenceProps.mock.lastCall![0].open).toBe(false);
    expect(agentSubmit.mock.calls[0][1]).toContain("Reference page styling");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      attachments: [chatAttachment],
      model: modelSelection.model,
      engine: modelSelection.engine,
      effort: modelSelection.effort,
    });
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          referenceDeckId: "own",
          composerContext,
          contextItems,
        }),
      }),
    );
    expect(attachments.commit).toHaveBeenCalledOnce();
  });

  it("starts selected design and website references without another selection step", async () => {
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

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());

    expect(referenceProps.mock.lastCall![0].open).toBe(false);
    expect(agentSubmit.mock.calls[0][1]).toContain("Brand tokens");
    expect(agentSubmit.mock.calls[0][1]).toContain("Reference page styling");
    expect(agentSubmit.mock.calls[0][2]).toMatchObject({
      attachments: [chatAttachment],
      model: modelSelection.model,
      engine: modelSelection.engine,
      effort: modelSelection.effort,
    });
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "own" },
      expect.anything(),
    );
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          designSystemId: "ds-explicit",
          referenceDeckId: "own",
          composerContext,
          contextItems,
        }),
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
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          referenceDeckId: null,
          composerContext,
          contextItems,
        }),
      }),
    );
  });

  it("keeps the attached setup card and composer mounted without a provider", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    renderHome();
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect(screen.getByRole("heading", { name: "Connect AI" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Builder.io" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Connect AI" })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("link", { name: "Custom keys" }).getAttribute("href"),
    ).toBe("/settings/keys");
    expect((prompt as HTMLTextAreaElement).disabled).toBe(false);
    expect(promptProps.mock.lastCall![0]).toMatchObject({
      disabled: false,
      requireAgentEngine: true,
      showMissingApiKeySetup: false,
      showModelSelector: false,
      modelStatusChecksEnabled: false,
    });
    expect(promptProps.mock.lastCall![0].onBeforeSubmit).toBeUndefined();

    fireEvent.pointerDown(
      document.querySelector("[data-slides-home-composer]")!,
      { button: 0, ctrlKey: false },
    );
    expect(
      screen
        .getByTestId("builder-setup-card")
        .getAttribute("data-bounce-pulse"),
    ).toBe("1");
    expect(createDeck).not.toHaveBeenCalled();
    expect(agentSubmit).not.toHaveBeenCalled();
  });

  it("keeps unknown and unavailable states editable without a checking state", async () => {
    agentEngine.state = "unknown";
    agentEngine.missing = false;
    const home = renderHome();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/checking ai/i)).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Presentation prompt",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(false);
    expect(promptProps.mock.lastCall![0].requireAgentEngine).toBe(true);
    expect(promptProps.mock.lastCall![0].onBeforeSubmit).toBeUndefined();

    agentEngine.state = "unavailable";
    await act(async () => home.rerenderHome());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Presentation prompt",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(false);
  });

  it("shows both tabs while loading, then defaults to Recent when decks are available", async () => {
    const home = renderHome({ loading: true });
    expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    useDecks.mockReturnValue({
      decks: [ownDeck],
      loading: false,
      loadError: false,
      deckListRefreshing: false,
      reloadDecks,
      createDeck,
      catchUpStaleDeckList: vi.fn(),
    });
    await act(async () => home.rerenderHome());

    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(window.localStorage.getItem("slides-home-library-tab")).toBe(
      "recent",
    );
    expect(window.localStorage.getItem("slides-home-has-recents")).toBe("true");

    home.unmount();
    renderHome({ decks: [ownDeck] });
    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("restores cached recents immediately while the deck list loads", () => {
    window.localStorage.setItem("slides-home-has-recents", "true");
    renderHome({ loading: true });

    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Templates" })).toBeTruthy();
  });

  it("restores a saved Templates choice before the deck list finishes loading", async () => {
    window.localStorage.setItem("slides-home-library-tab", "templates");
    const home = renderHome({ loading: true });
    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy();

    useDecks.mockReturnValue({
      decks: [ownDeck],
      loading: false,
      loadError: false,
      deckListRefreshing: false,
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
    expect(window.localStorage.getItem("slides-home-has-recents")).toBe("true");
  });

  it("keeps the Recent skeleton available when its tab opens during loading", () => {
    window.localStorage.setItem("slides-home-library-tab", "recent");
    renderHome({ loading: true });

    const recentPanel = screen.getByRole("tabpanel", { name: "Recent" });
    expect(recentPanel.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("does not server-render the home library", () => {
    const markup = renderToString(
      <MemoryRouter initialEntries={["/home"]}>
        <TooltipProvider>
          <ActiveIndex />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).not.toContain("agent-prompt-home-library");
  });

  it("shows both tabs and defaults to Templates without accessible decks", () => {
    const home = renderHome({ decks: [ownDeck] });
    expect(
      screen.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected"),
    ).toBe("true");

    home.unmount();
    renderHome({ decks: [] });
    expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(window.localStorage.getItem("slides-home-has-recents")).toBe(
      "false",
    );
  });

  it("keeps the composer as the focal point and shows both tabs without accessible work", async () => {
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
    expect(
      within(mountedHeader.container).queryByRole("searchbox", {
        name: "Search decks",
      }),
    ).toBeNull();
    const slash = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(slash);
    expect(slash.defaultPrevented).toBe(false);
    mountedHeader.unmount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Templates" }), {
      button: 0,
      ctrlKey: false,
    });
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
    expect(screen.getByText("Shared presentation")).toBeTruthy();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
  });

  it("keeps the recent panel available while searching a shared-only home", async () => {
    renderHome({ decks: [sharedDeck] });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search decks" }), {
      target: { value: "shared" },
    });
    expect(
      await screen.findByRole("tabpanel", { name: "Recent" }),
    ).toBeTruthy();
    expect(screen.getByText("Shared presentation")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Templates" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("tabpanel", { name: "Templates" })).toBeTruthy();
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

  it("holds the suggestion slot while loading and keeps the first result", async () => {
    suggestionQuery.pending = true;
    const { rerenderHome } = renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    const bar = screen.getByLabelText("home.suggestedPrompts");
    expect(bar.getAttribute("aria-busy")).toBe("true");
    expect(
      bar.querySelectorAll('[data-agent-suggestion-placeholder="true"]'),
    ).toHaveLength(3);

    suggestionQuery.pending = false;
    rerenderHome();
    await screen.findByRole("button", { name: "Build a pitch" });
    expect(suggestionQuery.enabled).toBe(false);

    homeSuggestions.value = [
      {
        id: "suggestion-2",
        label: "Changed after load",
        prompt: "Create a different deck.",
      },
    ];
    rerenderHome();
    expect(screen.getByRole("button", { name: "Build a pitch" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Changed after load" }),
    ).toBeNull();
  });

  it("keeps the home suggestion sample when the retained route becomes inactive", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(suggestionQuery.enabled).toBe(false);
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
    await waitFor(() => expect(suggestionQuery.enabled).toBe(false));
    expect(systemFlag.query).toHaveBeenLastCalledWith(true);
    expect(inactiveHomeQueries.workspaceDefaultsEnabled).toBe(true);
    expect(inactiveHomeQueries.templateLibraryEnabled).toBe(true);
    expect(promptProps.mock.lastCall![0].active).toBe(true);
  });

  it("preserves the blank-deck reference step across template navigation", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    await act(async () => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      props.onSkip?.();
    });
    expect(promptProps.mock.lastCall![0].open).toBe(false);
    expect(referenceProps.mock.lastCall![0].open).toBe(true);
    expect(referenceProps.mock.lastCall![0]).not.toHaveProperty(
      "defaultReferenceDeckId",
    );

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));
    await waitFor(() =>
      expect(referenceProps.mock.lastCall![0].open).toBe(false),
    );

    fireEvent.click(screen.getByRole("link", { name: "Back home" }));
    await waitFor(() =>
      expect(referenceProps.mock.lastCall![0].open).toBe(true),
    );
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
    "reserves suggestions while gating model controls for $state (missing=$missing)",
    async ({ state, missing, ready }) => {
      agentEngine.state = state;
      agentEngine.missing = missing;
      renderHome();
      await screen.findByRole("textbox", { name: "Presentation prompt" });
      expect(promptProps.mock.lastCall![0]).toMatchObject({
        disabled: false,
        showModelSelector: ready,
        modelStatusChecksEnabled: ready,
        requireAgentEngine: true,
        showMissingApiKeySetup: false,
      });
      expect(promptProps.mock.lastCall![0].onBeforeSubmit).toBeUndefined();
      expect(promptProps.mock.lastCall![0].submissionDisabled).toBeUndefined();
      const suggestionBar = screen.queryByLabelText("home.suggestedPrompts");
      const loading = state === "unknown";
      const unavailable = state === "unavailable";
      expect(Boolean(suggestionBar)).toBe(ready || loading || unavailable);
      expect(suggestionBar?.getAttribute("aria-busy") ?? null).toBe(
        loading ? "true" : null,
      );
      expect(
        Boolean(screen.queryByRole("button", { name: "Build a pitch" })),
      ).toBe(ready);
      expect(
        Boolean(
          screen.queryByRole("button", {
            name: "Create a product pitch deck",
          }),
        ),
      ).toBe(unavailable);
      if (ready) {
        expect(
          screen.getByRole<HTMLButtonElement>("button", {
            name: "Build a pitch",
          }).disabled,
        ).toBe(false);
      }
      expect(suggestionQuery.enabled).toBe(false);
    },
  );

  it("generates from the full pending retry context without reference selection", async () => {
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
        retryReferenceSelection: {
          referenceDeckId: "reference-deck",
          referenceFilePaths: [uploadedFile.path],
          importedReferenceFilePath: uploadedFile.path,
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
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(referenceProps.mock.lastCall![0].open).toBe(false);
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
    expect(attachments.commit).toHaveBeenCalledOnce();
  });

  it("keeps a reference-step deck when the retry composer has no deck reference", async () => {
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
        retryReferenceSelection: { referenceDeckId: "reference-deck" },
      },
    );
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };

    await act(async () => {
      promptProps.mock.lastCall![0].onSubmit(
        "Create a roadmap",
        [],
        attachments,
        {
          slidesContext: { designSystemId: null, references: [] },
          contextItems: [],
        },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "reference-deck" },
      { method: "GET" },
    );
  });

  it.each([
    {
      editedPrompt: `Use this style: ${window.location.origin}/deck/own`,
      expectedDeckId: "own",
    },
    {
      editedPrompt: "Create a roadmap without a deck link",
      expectedDeckId: null,
    },
  ])(
    "recomputes a prompt-inferred deck after an edited retry: $editedPrompt",
    async ({ editedPrompt, expectedDeckId }) => {
      createDeck.mockReturnValue({ id: "new-deck" });
      renderHome(
        {
          decks: [ownDeck, sharedDeck],
          ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
          deleteDeck: vi.fn(),
        },
        {
          retryPrompt: `Use this style: ${window.location.origin}/deck/shared`,
          retryReferenceSelection: {
            referenceDeckId: "shared",
            referenceDeckIdSource: "prompt",
          },
        },
      );
      await screen.findByRole("textbox", { name: "Presentation prompt" });

      await act(async () => {
        await promptProps.mock.lastCall![0].onSubmit(editedPrompt, [], {
          commit: vi.fn(),
          discard: vi.fn(),
          attachments: [],
        });
      });

      await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
      if (expectedDeckId) {
        expect(callAction).toHaveBeenCalledWith(
          "get-deck-reference-context",
          { id: expectedDeckId },
          { method: "GET" },
        );
      } else {
        expect(callAction).not.toHaveBeenCalledWith(
          "get-deck-reference-context",
          expect.anything(),
          expect.anything(),
        );
      }
    },
  );

  it("lets a prompt link override an automatic recent deck", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    automaticReferenceDeck.value = "shared";
    const composerContext = {
      designSystemId: null,
      references: [
        { source: "slides" as const, id: "shared", title: "Recent deck" },
      ],
    };
    contextSelection.value = composerContext;
    const contextItems = [
      {
        key: "slides:shared:",
        title: "Recent deck",
        context: "Automatic recent-deck context",
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
        `Use this style: ${window.location.origin}/deck/own`,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
        { slidesContext: composerContext, contextItems },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "own" },
      { method: "GET" },
    );
    expect(agentSubmit.mock.calls[0][1]).not.toContain(
      "Automatic recent-deck context",
    );
  });

  it("keeps selected deck context when a retry's automatic marker shares its id", async () => {
    createDeck.mockReturnValue({ id: "new-deck" });
    const prompt = `Use this as a style reference: ${window.location.origin}/deck/own`;
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
        context: "Explicitly selected deck context",
        status: "ready" as const,
      },
    ];
    renderHome(
      {
        decks: [ownDeck, sharedDeck],
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
      },
      {
        retryPrompt: prompt,
        retryReferenceSelection: {
          automaticReferenceDeckId: "shared",
          referenceDeckId: "shared",
          referenceDeckIdSource: "selection",
          composerContext,
          contextItems,
        },
      },
    );
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        prompt,
        [],
        { commit: vi.fn(), discard: vi.fn(), attachments: [] },
        { slidesContext: composerContext, contextItems },
      );
    });

    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(agentSubmit.mock.calls[0][1]).toContain(
      "Explicitly selected deck context",
    );
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          referenceDeckId: null,
          composerContext,
          contextItems,
        }),
      }),
    );
  });

  it("recomputes prompt-linked decks when a retry prompt changes", async () => {
    createDeck.mockReturnValue({ id: "generated-deck" });
    renderHome(
      {
        decks: [
          { id: "old-deck", title: "Old deck", createdByMe: true },
          { id: "new-deck", title: "New deck", createdByMe: true },
        ],
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
      },
      {
        retryPrompt: "Use the old deck",
        retryReferenceSelection: {
          referenceDeckId: "old-deck",
          referenceDeckIdSource: "automatic",
        },
      },
    );
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const attachments = { commit: vi.fn(), discard: vi.fn(), attachments: [] };
    const prompt = `Use this style: ${window.location.origin}${appPath("/deck/new-deck")}`;
    expect(
      findPromptReferenceDeckId(prompt, window.location.origin, [
        { id: "old-deck" },
        { id: "new-deck" },
      ]),
    ).toBe("new-deck");

    await act(async () => {
      promptProps.mock.lastCall![0].onSubmit(prompt, [], attachments, {
        slidesContext: { designSystemId: null, references: [] },
        contextItems: [],
      });
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "new-deck" },
      { method: "GET" },
    );
  });

  it("uses generic copy for a storage status failure during reference import", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    act(() => promptProps.mock.lastCall![0].onSkip?.());
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

    act(() => promptProps.mock.lastCall![0].onSkip?.());
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

  it("does not treat an unreachable session check as signed out", async () => {
    signedIn.value = false;
    signedIn.unreachable = true;
    const home = renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    act(() => {
      const props = promptProps.mock.lastCall![0] as ComponentProps<
        typeof PromptPopover
      >;
      expect(props.onBeforeUpload?.("My outline", [], "", [])).toBe(true);
    });
    expect(sessionStorage.getItem("slides:pending-deck-prompt")).toBeNull();
    home.unmount();
  });

  it("restores composer references through the sign-in draft", async () => {
    signedIn.value = false;
    createDeck.mockReturnValue({ id: "new-deck" });
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
    };
    const composerContext = {
      designSystemId: "design-system-from-composer",
      references: [
        {
          source: "website" as const,
          id: "https://example.com/reference",
          title: "Reference site",
          url: "https://example.com/reference",
        },
      ],
    };
    const contextItems = [
      {
        key: "system:design-system-from-composer",
        title: "Design system",
        context: "Use these design tokens",
        status: "ready" as const,
      },
      {
        key: "website:https://example.com/reference:",
        title: "Reference site",
        context: "Reference styling",
        status: "ready" as const,
      },
    ];
    contextSelection.value = composerContext;
    const home = renderHome({
      decks: [ownDeck],
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const referenceSelection = {
      designSystemId: composerContext.designSystemId,
      composerContext,
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
    expect(
      JSON.parse(
        sessionStorage.getItem("slides:pending-deck-reference-selection") ??
          "null",
      ),
    ).toEqual(referenceSelection);
    fireEvent.click(screen.getByRole("button", { name: "home.cancel" }));
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(contextOptions.mock.lastCall?.[0]).toMatchObject({
      initialSelection: composerContext,
    });
    expect(promptProps.mock.lastCall![0].initialModelSelection).toEqual(
      modelSelection,
    );
    expect(localStorage.getItem("an-composer-draft:slides-new-deck")).toContain(
      "My saved outline",
    );
    expect(createDeck).not.toHaveBeenCalled();

    signedIn.value = true;
    home.rerenderHome();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Presentation prompt",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("My saved outline"),
    );
    const promptWithDeckReference = `Use this style reference: ${window.location.origin}/deck/own?slide=7`;
    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
        promptWithDeckReference,
        [],
        {
          commit: vi.fn(),
          discard: vi.fn(),
          attachments: [],
          context: "Reference context",
        },
        {
          ...modelSelection,
          slidesContext: composerContext,
          contextItems,
        },
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(callAction).toHaveBeenCalledWith(
      "get-deck-reference-context",
      { id: "own" },
      expect.anything(),
    );
  });

  it("does not save an automatic recent deck as a sign-in deck choice", async () => {
    signedIn.value = false;
    localStorage.setItem(
      "slides:recent-references",
      JSON.stringify([{ id: "shared", kind: "deck", lastUsedAt: 1 }]),
    );
    automaticReferenceDeck.value = "shared";
    contextSelection.value = {
      designSystemId: null,
      references: [{ source: "slides", id: "shared", title: "Recent deck" }],
    };
    renderHome({ decks: [ownDeck, sharedDeck] });
    await screen.findByRole("textbox", { name: "Presentation prompt" });

    await act(async () => {
      expect(
        promptProps.mock.lastCall![0].onBeforeUpload(
          `Use this style: ${window.location.origin}/deck/own`,
          [],
          undefined,
          undefined,
          undefined,
        ),
      ).toBe(false);
    });

    const savedSelection = JSON.parse(
      sessionStorage.getItem("slides:pending-deck-reference-selection") ??
        "null",
    );
    expect(savedSelection).toMatchObject({
      automaticReferenceDeckId: "shared",
    });
    expect(savedSelection).not.toHaveProperty("referenceDeckId");
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
    createDeck.mockReturnValue({ id: "new-deck" });
    const home = renderHome({
      ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
      deleteDeck: vi.fn(),
    });
    const prompt = await screen.findByRole("textbox", {
      name: "Presentation prompt",
    });
    expect((prompt as HTMLTextAreaElement).value).toBe("");
    const modelSelection = {
      model: "test-model",
      engine: "builder",
      effort: "high",
    };
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
        context: "Reference deck style",
        status: "ready" as const,
      },
    ];
    const referenceSelection = {
      designSystemId: null,
      referenceDeckId: null,
      composerContext,
      contextItems,
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
    sessionStorage.setItem(
      "slides:pending-deck-reference-selection",
      JSON.stringify(referenceSelection),
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
    expect(
      sessionStorage.getItem("slides:pending-deck-reference-selection"),
    ).toBeNull();
    expect(contextOptions.mock.lastCall?.[0]).toMatchObject({
      initialSelection: composerContext,
    });
    await act(async () => {
      await promptProps.mock.lastCall![0].onSubmit(
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
          slidesContext: composerContext,
          contextItems,
        },
      );
    });
    await waitFor(() => expect(agentSubmit).toHaveBeenCalledOnce());
    expect(referenceProps.mock.lastCall![0].open).toBe(false);
    expect(createDeck).toHaveBeenCalledOnce();
    expect(updateDeck).toHaveBeenCalledWith(
      "new-deck",
      expect.objectContaining({
        generationContext: expect.objectContaining({
          composerContext,
          contextItems,
        }),
      }),
    );
  });

  it("removes a legacy automatic reference from a saved sign-in prompt", async () => {
    signedIn.value = false;
    const home = renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    const composerContext = {
      designSystemId: null,
      references: [
        {
          source: "slides" as const,
          id: "recent-deck",
          title: "Recent deck",
        },
        {
          source: "website" as const,
          id: "https://example.com",
          title: "Example",
          url: "https://example.com",
        },
      ],
    };
    sessionStorage.setItem("slides:pending-deck-prompt", "Continue");
    sessionStorage.setItem(
      "slides:pending-deck-reference-selection",
      JSON.stringify({
        automaticReferenceDeckId: "recent-deck",
        composerContext,
        contextItems: [
          { key: "slides:recent-deck:", title: "Recent deck", context: "" },
          {
            key: "website:https://example.com:",
            title: "Example",
            context: "",
          },
        ],
      }),
    );

    signedIn.value = true;
    home.rerenderHome();

    await waitFor(() =>
      expect(contextOptions.mock.lastCall?.[0].initialSelection).toEqual({
        designSystemId: null,
        references: [composerContext.references[1]],
      }),
    );
  });
});
