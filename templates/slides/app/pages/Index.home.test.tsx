// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type PromptPopover from "@/components/editor/PromptDialog";

const {
  useDecks,
  reloadDecks,
  createDeck,
  promptProps,
  referenceProps,
  signedIn,
  agentEngine,
  builderConnect,
  useBuilderConnectFlow,
} = vi.hoisted(() => ({
  useDecks: vi.fn(),
  reloadDecks: vi.fn(),
  createDeck: vi.fn(),
  promptProps: vi.fn(),
  referenceProps: vi.fn(),
  signedIn: { value: true },
  agentEngine: { missing: false },
  builderConnect: { connecting: false, error: null as string | null },
  useBuilderConnectFlow: vi.fn(),
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
    "root.searchDecks": "Search decks",
  })[key] ?? key;

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentEngineConfigured: () => agentEngine,
}));
vi.mock("@agent-native/core/client/settings", () => ({
  useBuilderConnectFlow,
  BuilderConnectPopover: ({ children }: { children: ReactNode }) => (
    <div data-testid="builder-connect-popover">{children}</div>
  ),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
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
vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: vi.fn(),
  useSetPageTitle: vi.fn(),
}));
vi.mock("@/context/DeckContext", () => ({
  useDecks,
  describeDeckPersistenceFailure: vi.fn(),
  deckIdFromPathname: vi.fn(),
}));
vi.mock("@/hooks/use-agent-generating", () => ({
  useAgentGenerating: () => ({ generating: false, submit: vi.fn() }),
  clearStartedGenerationAttempt: vi.fn(),
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({ designSystems: [], refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-workspace-defaults", () => ({
  useWorkspaceDefaults: () => ({ refetch: vi.fn() }),
}));
vi.mock("@/components/deck/DeckCard", () => ({
  default: ({ deck }: { deck: { title: string } }) => (
    <article>{deck.title}</article>
  ),
}));
vi.mock("@/components/editor/DeckEditorSkeleton", () => ({
  DeckEditorSkeleton: () => null,
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
      />
    );
  },
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import Index from "./Index";

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

function renderHome(overrides: Record<string, unknown> = {}, state?: unknown) {
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
    <MemoryRouter initialEntries={[{ pathname: "/home", state }]}>
      <TooltipProvider>
        <Index />
      </TooltipProvider>
    </MemoryRouter>
  );
  const result = render(home());
  return { ...result, rerenderHome: () => result.rerender(home()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn.value = true;
  agentEngine.missing = false;
  builderConnect.connecting = false;
  builderConnect.error = null;
  useBuilderConnectFlow.mockReturnValue(builderConnect);
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
  it("uses the separate Builder connection CTA and suppresses embedded provider UI only while missing", async () => {
    agentEngine.missing = true;
    const missing = renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(
      screen
        .getByTestId("builder-connect-popover")
        .contains(screen.getByRole("button", { name: "Connect Builder.io" })),
    ).toBe(true);
    expect(useBuilderConnectFlow).toHaveBeenLastCalledWith({
      enabled: true,
      provisionAccount: true,
      trackingSource: "slides_home",
    });
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: true,
        showModelSelector: false,
        modelStatusChecksEnabled: false,
        onImport: expect.any(Function),
        onSkip: expect.any(Function),
      }),
    );
    missing.unmount();
    agentEngine.missing = false;
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.queryByTestId("builder-connect-popover")).toBeNull();
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        disabled: false,
        showModelSelector: true,
        modelStatusChecksEnabled: true,
      }),
    );
    expect(createDeck).not.toHaveBeenCalled();
  });

  it("shows connection progress and preserves an actionable retry after a connection error", async () => {
    agentEngine.missing = true;
    builderConnect.connecting = true;
    const connecting = renderHome();
    expect(
      (
        screen.getByRole("button", {
          name: "Connecting Builder.io…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    connecting.unmount();
    builderConnect.connecting = false;
    builderConnect.error = "Connection interrupted";
    renderHome();
    expect(screen.getByRole("alert").textContent).toBe(
      "Connection interrupted",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Builder.io",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await screen.findByRole("textbox", { name: "Presentation prompt" });
  });

  it.each([{ decks: [] }, { decks: [sharedDeck] }])(
    "keeps the composer as the focal point without owned work (%j)",
    async ({ decks }) => {
      renderHome({ decks });
      expect(
        screen.getByRole("heading", {
          name: "What kind of presentation should we generate?",
        }),
      ).toBeTruthy();
      expect(
        await screen.findByRole("textbox", { name: "Presentation prompt" }),
      ).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
      expect(screen.queryByRole("link", { name: /browse all/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /new deck/i })).toBeNull();
    },
  );

  it("gates recents on the unfiltered owned collection, not matching search results", async () => {
    renderHome({ decks: [ownDeck, sharedDeck] });
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("My presentation")).toBeTruthy();
    expect(screen.queryByText("Shared presentation")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search decks" }), {
      target: { value: "no match" },
    });
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
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
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    expect(screen.getByText("My presentation")).toBeTruthy();
    useDecks.mockReturnValue({ ...useDecks(), loadError: true });
    home.rerenderHome();
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
    expect(screen.getByText("My presentation")).toBeTruthy();
    expect(screen.queryByText("Couldn't load your content")).toBeNull();
  });

  it("only seeds the existing draft when a starter is chosen", async () => {
    renderHome();
    await screen.findByRole("textbox", { name: "Presentation prompt" });
    fireEvent.click(screen.getByRole("button", { name: "Pitch deck" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Presentation prompt",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("Create a pitch deck about "),
    );
    expect(promptProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: "inline",
        initialTextKey: expect.any(Number),
        draftScope: "slides-new-deck",
      }),
    );
    expect(createDeck).not.toHaveBeenCalled();
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
