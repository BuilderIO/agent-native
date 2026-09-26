// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
const toastError = vi.hoisted(() => vi.fn());
const homeImport = vi.hoisted(() => ({ current: null as unknown }));
const promptUploads = vi.hoisted(() => ({
  uploadPromptFiles: vi.fn(),
  cleanupUploadedPromptFiles: vi.fn(),
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
  agentSubmit,
  callAction,
  contextOptions,
  refetchSystems,
  headerActions,
  pageTitle,
} = vi.hoisted(() => ({
  useDecks: vi.fn(),
  reloadDecks: vi.fn(),
  createDeck: vi.fn(),
  promptProps: vi.fn(),
  referenceProps: vi.fn(),
  signedIn: { value: true },
  agentEngine: { state: "configured", missing: false },
  agentSubmit: vi.fn(),
  callAction: vi.fn().mockResolvedValue(undefined),
  contextOptions: vi.fn(),
  refetchSystems: vi.fn(),
  headerActions: { current: null as ReactNode | null },
  pageTitle: { current: null as ReactNode | null },
}));
const translate = (key: string) =>
  ({
    "home.firstDeckPromptTitle":
      "What kind of presentation should we generate?",
    "home.recent": "Recent",
    "home.connectBuilderIo": "Connect Builder.io",
    "home.connectingBuilder": "Connecting Builder.io…",
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
vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderSetupCard: ({ onConnected }: { onConnected?: () => void }) => (
    <div data-testid="ai-setup-card">
      <h3>Connect AI</h3>
      <button onClick={onConnected}>Connect Builder.io</button>
      <a href="/settings/keys">Custom keys</a>
    </div>
  ),
  useAgentEngineConfigured: () => agentEngine,
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
        data: {
          suggestions: [
            {
              id: "suggestion-1",
              label: "Build a pitch",
              prompt: "Create a pitch deck for a new product.",
            },
          ],
        },
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
  return {
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app-shell")
    >()),
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
  DeckTemplateLibrary: () => <div>Starter template library</div>,
}));
vi.mock("@/hooks/use-agent-generating", () => ({
  useAgentGenerating: () => ({ generating: false, submit: agentSubmit }),
  clearStartedGenerationAttempt: vi.fn(),
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: (enabled: boolean) => (
    systemFlag.query(enabled),
    { designSystems: [], refetch: refetchSystems }
  ),
}));
vi.mock("@/hooks/use-workspace-defaults", () => ({
  useWorkspaceDefaults: () => ({ refetch: vi.fn() }),
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

import { TooltipProvider } from "@/components/ui/tooltip";

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
  systemFlag.enabled = true;
  suggestionQuery.enabled = undefined;
  homeImport.current = null;
  createDeck.mockReset();
  signedIn.value = true;
  agentEngine.state = "configured";
  agentEngine.missing = false;
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
    const options = {
      model: "test-model",
      engine: "builder",
      effort: "high" as const,
      slidesContext: { designSystemId: null, references: [] },
      contextItems: [],
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
                composerContext: options.slidesContext,
                contextItems: [],
              }),
            },
          }),
        ],
      }),
    );
    expect(commit).toHaveBeenCalledOnce();
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
    expect(promptProps.mock.lastCall![0].disabled).toBe(true);
    expect(promptProps.mock.lastCall![0].submissionDisabled).toBe(true);
    expect(createDeck).not.toHaveBeenCalled();
  });
  it("shows Builder and custom-key setup while gating the composer until configured", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    const missing = renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.getByRole("heading", { name: "Connect AI" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Builder.io" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Custom keys" }).getAttribute("href"),
    ).toBe("/settings/keys");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Presentation prompt",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: true,
        submissionDisabled: true,
        showModelSelector: false,
        modelStatusChecksEnabled: false,
        onSkip: expect.any(Function),
      }),
    );
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
    missing.unmount();
    agentEngine.state = "configured";
    agentEngine.missing = false;
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.queryByTestId("ai-setup-card")).toBeNull();
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        submissionDisabled: false,
        showModelSelector: true,
        modelStatusChecksEnabled: false,
      }),
    );
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("keeps the composer disabled until provider status is known and offers retry when unavailable", async () => {
    agentEngine.state = "unknown";
    renderHome();
    expect(screen.getByRole("status").textContent).toContain(
      "agentChat.setup.checkingProvider",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Presentation prompt",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    cleanup();
    agentEngine.state = "unavailable";
    renderHome();
    const dispatch = vi.spyOn(window, "dispatchEvent");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-engine:configured-changed" }),
    );
  });

  it("keeps the composer as the focal point without accessible work", async () => {
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
    expect(
      screen.getByRole("link", { name: /browse all/i }).getAttribute("href"),
    ).toBe("/templates");
    expect(screen.getByText("Starter template library")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new deck/i })).toBeNull();
  });

  it("shows the Recent tab for shared-only accessible decks", async () => {
    renderHome({ decks: [sharedDeck] });
    expect(await screen.findByRole("tab", { name: "Recent" })).toBeTruthy();
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

  it("gates recents on the unfiltered owned collection, not matching search results", async () => {
    renderHome({ decks: [ownDeck, sharedDeck] });
    expect(
      screen
        .getByRole("tab", { name: "Templates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Recent" }), {
      button: 0,
      ctrlKey: false,
    });
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

    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));

    await waitFor(() =>
      expect(promptProps.mock.lastCall![0].disabled).toBe(true),
    );
    await waitFor(() => expect(suggestionQuery.enabled).toBe(false));
  });

  it("hides home suggestions until the provider status is confirmed", async () => {
    agentEngine.state = "missing";
    agentEngine.missing = true;
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.queryByRole("button", { name: "Build a pitch" })).toBeNull();
  });

  it("reopens the inline prompt on reference cancellation without discarding uploads just for hiding it", async () => {
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
    expect(
      screen.queryByRole("textbox", { name: "Presentation prompt" }),
    ).toBeNull();
    expect(attachments.discard).not.toHaveBeenCalled();
    act(() => referenceProps.mock.lastCall![0].onOpenChange(false));
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "Presentation prompt",
        })) as HTMLTextAreaElement
      ).value,
    ).toBe("My outline");
    expect(attachments.discard).toHaveBeenCalledOnce();
    expect(createDeck).not.toHaveBeenCalled();
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

    expect(promptUploads.cleanupUploadedPromptFiles).toHaveBeenCalledWith([
      uploaded,
    ]);
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
    expect(createDeck).not.toHaveBeenCalled();
  });
});
