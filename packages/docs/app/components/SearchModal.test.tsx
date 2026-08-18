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

vi.mock("@agent-native/core/client/agent-chat", () => ({
  focusAgentChat: vi.fn(),
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
  useDocsTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("./docs-content", () => ({
  buildSearchIndexAsync: vi.fn(),
}));

import { buildSearchIndexAsync } from "./docs-content";
import { SearchModal } from "./SearchModal";

const buildSearchIndexAsyncMock = vi.mocked(buildSearchIndexAsync);

describe("SearchModal", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    HTMLElement.prototype.scrollIntoView = vi.fn();
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
});
