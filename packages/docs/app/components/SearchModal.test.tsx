// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  toggleThemeMock: vi.fn(),
  selectedEngine: "auto",
  providerStatus: "configured" as
    | "configured"
    | "missing"
    | "unknown"
    | "unavailable",
  modelOptions: [] as unknown[],
  providerEnabled: [] as boolean[],
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderSetupCard: () => null,
  chatModelSelectionStorageKey: (namespace?: string | null) =>
    namespace
      ? `agent-native:chat-models:selection:${namespace}`
      : "agent-native:chat-models:selection",
  focusAgentChat: vi.fn(),
  useAgentEngineConfigured: (enabled: boolean) => {
    state.providerEnabled.push(enabled);
    return { state: enabled ? state.providerStatus : "configured" };
  },
  useChatModels: (options: unknown) => {
    state.modelOptions.push(options);
    return { selectedEngine: state.selectedEngine };
  },
}));
vi.mock("@agent-native/core/client/composer", () => ({
  isLocalRuntimeEngine: (engine: string) => engine === "ollama",
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  return {
    ...actual,
    useLocale: () => ({ locale: "en-US" }),
    useT: () => (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
        "header.askAssistant": "Ask AI",
        "search.browseAllDocs": "Browse all docs",
        "search.dialogLabel": "Search documentation",
        "search.empty": "Type to search across all documentation",
        "search.loadError": "Search couldn't load. Try again.",
        "search.noResults": `No results found for "${values?.query ?? ""}"`,
        "search.placeholder": "Search documentation...",
        "search.retry": "Try again",
        "search.toggleChatSidebar": "Toggle chat sidebar",
        "theme.dark": "dark",
        "theme.light": "light",
        "theme.toggle": "Toggle theme",
      };
      return messages[key] ?? key;
    },
  };
});

vi.mock("@agent-native/core/client/navigation", () => ({
  submitToAgent: vi.fn(),
}));

vi.mock("./ThemeToggle", () => ({
  useDocsTheme: () => ({ theme: "light", toggleTheme: state.toggleThemeMock }),
}));

vi.mock("./docs-content", () => ({
  buildSearchIndexAsync: vi.fn(),
}));

import { submitToAgent } from "@agent-native/core/client/navigation";

import { buildSearchIndexAsync } from "./docs-content";
import { SearchModal } from "./SearchModal";

const buildSearchIndexAsyncMock = vi.mocked(buildSearchIndexAsync);

describe("SearchModal", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    HTMLElement.prototype.scrollIntoView = vi.fn();
    state.selectedEngine = "auto";
    state.providerStatus = "configured";
    state.modelOptions = [];
    state.providerEnabled = [];
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    vi.clearAllMocks();
  });

  it("shows a retry state and can recover from a failed index load", async () => {
    buildSearchIndexAsyncMock
      .mockRejectedValueOnce(new Error("document chunk unavailable"))
      .mockResolvedValueOnce([
        {
          page: "Actions",
          path: "/docs/actions",
          section: "Actions",
          sectionId: "",
          text: "Actions are the single source of truth.",
          keywords: "actions",
        },
      ]);

    render(
      <MemoryRouter>
        <SearchModal open onClose={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "actions" },
    });
    expect(
      await screen.findByText("Search couldn't load. Try again."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(buildSearchIndexAsyncMock).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findAllByText("Actions")).length).toBeGreaterThan(0);
  });

  it("places theme and chat sidebar actions below the empty state", async () => {
    buildSearchIndexAsyncMock.mockResolvedValue([]);
    const toggleSidebar = vi.fn();
    window.addEventListener("agent-panel:toggle", toggleSidebar);

    try {
      render(
        <MemoryRouter>
          <SearchModal open onClose={vi.fn()} />
        </MemoryRouter>,
      );

      const emptyState = screen.getByText(
        "Type to search across all documentation",
      );
      const themeAction = screen.getByRole("button", {
        name: "Toggle theme",
      });
      const sidebarAction = screen.getByRole("button", {
        name: "Toggle chat sidebar",
      });

      expect(
        emptyState.compareDocumentPosition(themeAction) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        themeAction.compareDocumentPosition(sidebarAction) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      fireEvent.click(themeAction);
      fireEvent.click(sidebarAction);

      expect(state.toggleThemeMock).toHaveBeenCalledTimes(1);
      expect(toggleSidebar).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("agent-panel:toggle", toggleSidebar);
    }
  });

  it("uses the docs chat selection to allow a configured local model", async () => {
    buildSearchIndexAsyncMock.mockResolvedValue([]);
    state.selectedEngine = "ollama";
    state.providerStatus = "missing";
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <SearchModal open onClose={onClose} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "How do I configure chat?" },
    });
    const askButton = screen.getByRole("button", {
      name: /Ask AI/,
    });

    expect((askButton as HTMLButtonElement).disabled).toBe(false);
    expect(state.modelOptions).toContainEqual({
      enabled: false,
      storageKey: "agent-native:chat-models:selection:docs",
    });
    expect(state.providerEnabled).toContain(false);

    fireEvent.click(askButton);

    expect(vi.mocked(submitToAgent)).toHaveBeenCalledWith(
      "How do I configure chat?",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Ask AI until an LLM provider is configured", () => {
    buildSearchIndexAsyncMock.mockResolvedValue([]);
    state.providerStatus = "missing";

    render(
      <MemoryRouter>
        <SearchModal open onClose={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "How do I configure chat?" },
    });
    const askButton = screen.getByRole("button", { name: /Ask AI/ });
    expect((askButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(askButton);
    expect(vi.mocked(submitToAgent)).not.toHaveBeenCalled();
  });
});
