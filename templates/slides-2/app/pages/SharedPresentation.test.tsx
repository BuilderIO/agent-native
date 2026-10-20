// @vitest-environment happy-dom

import type { SharedDeckResponse } from "@shared/api";
import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderQuery: {
    data: undefined as unknown,
    error: undefined as unknown,
    isLoading: false,
  },
  renderQueries: [] as Array<{
    action: string;
    args: Record<string, unknown>;
    enabled?: boolean;
  }>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  callAction: vi.fn(),
  useActionQuery: (
    action: string,
    args: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.renderQueries.push({ action, args, enabled: options?.enabled });
    return mocks.renderQuery;
  },
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-deck-design-system", () => ({
  mergeDesignSystemData: (data: unknown) => data,
}));

vi.mock("@/lib/export-pdf-client", () => ({ exportDeckAsPdf: vi.fn() }));
vi.mock("@/components/presentation/present-channel", () => ({
  openPresentChannel: () => null,
}));

// The real SlideRenderer sanitizes and injects the stored HTML. This stand-in
// injects it as-is so the build attributes reach the DOM the runtime queries.
vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: { id: string; content: string } }) => (
    <div
      data-testid={`rendered-${slide.id}`}
      dangerouslySetInnerHTML={{ __html: slide.content }}
    />
  ),
}));

vi.mock("@/components/slides-2-runtime/Slides2Canvas", async () => {
  const { createElement } = await import("react");
  return {
    Slides2Canvas: ({ children }: { children: React.ReactNode }) =>
      createElement("div", { "data-testid": "slides-2-canvas" }, children),
  };
});

vi.mock("@/components/slides-2-runtime/SandboxedSlide", async () => {
  const { createElement } = await import("react");
  return {
    SandboxedSlide: ({ artifact }: { artifact: { slideId: string } }) =>
      createElement("div", {
        "data-testid": `sandboxed-${artifact.slideId}`,
      }),
  };
});

import SharedPresentation from "./SharedPresentation";

const revealSlide = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

const deck = {
  title: "Reveal deck",
  slides: [
    { id: "plain", content: "", layout: "content" },
    {
      id: "reveal",
      content: revealSlide,
      layout: "content",
      animations: [
        {
          id: "body",
          elementIndex: 0,
          elementPath: [0],
          byParagraph: true,
          type: "fade",
        },
      ],
    },
    { id: "after", content: "", layout: "content" },
  ],
} as unknown as SharedDeckResponse;

function tree(
  url: string,
  options: {
    initialDeck?: SharedDeckResponse;
    sourceDeckId?: string;
  } = {},
) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/p/:id"
          element={
            <SharedPresentation
              initialDeck={options.initialDeck ?? deck}
              sourceDeckId={options.sourceDeckId}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function snapshotTree(url: string, initialDeck: SharedDeckResponse = deck) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/share/:token"
          element={<SharedPresentation initialDeck={initialDeck} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function revealParagraphs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-pstep]"),
  ).sort(
    (a, b) =>
      Number(a.getAttribute("data-pstep")) -
      Number(b.getAttribute("data-pstep")),
  );
}

afterEach(() => {
  cleanup();
  mocks.renderQuery = { data: undefined, error: undefined, isLoading: false };
  mocks.renderQueries = [];
});

describe("SharedPresentation deep link", () => {
  it("server markup is the same shell whatever the ?slide= query", () => {
    const markup = renderToStaticMarkup(tree("/p/deck-1?slide=2"));

    expect(markup).toContain("1 / 3");
    expect(markup).not.toContain("2 / 3");
  });

  it("opens ?slide=2 on slide 2 with its reveals hidden", () => {
    render(tree("/p/deck-1?slide=2"));

    expect(screen.getByText("2 / 3")).toBeTruthy();
    const paragraphs = revealParagraphs();
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(paragraph.getAttribute("data-pstep-state")).toBe("hidden");
    }
  });

  it("hydrates the shell without a mismatch, then opens ?slide=2", async () => {
    // Hydration needs renderToString's text-node comments, not the static markup.
    const shell = renderToString(tree("/p/deck-1?slide=2"));
    const host = document.createElement("div");
    host.innerHTML = shell;
    document.body.appendChild(host);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, tree("/p/deck-1?slide=2"));
      });

      expect(consoleError).not.toHaveBeenCalled();
      expect(screen.getByText("2 / 3")).toBeTruthy();
      for (const paragraph of revealParagraphs()) {
        expect(paragraph.getAttribute("data-pstep-state")).toBe("hidden");
      }
    } finally {
      await act(async () => root?.unmount());
      consoleError.mockRestore();
      host.remove();
    }
  });

  it("opens the first slide without a ?slide= query", () => {
    render(tree("/p/deck-1"));

    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("renders a source-only public slide through its live deck runtime", () => {
    const sourceDeck = {
      title: "Source deck",
      slides: [
        {
          id: "source-slide",
          content: "",
          sourceRuntimeRequired: true,
          notes: "",
          layout: "content",
        },
      ],
    } as SharedDeckResponse;
    const artifact = {
      deckId: "deck-live",
      slideId: "source-slide",
      revision: 1,
      sourceHash: "a".repeat(64),
    };
    mocks.renderQuery.data = artifact;

    render(
      tree("/p/deck-live", {
        initialDeck: sourceDeck,
        sourceDeckId: "deck-live",
      }),
    );

    expect(mocks.renderQueries).toContainEqual({
      action: "get-slide-render",
      args: { deckId: "deck-live", slideId: "source-slide" },
      enabled: true,
    });
    expect(screen.getByTestId("sandboxed-source-slide")).toBeTruthy();
  });

  it("offers PDF export for live public decks and token snapshots", () => {
    const sourceDeck = {
      title: "Source deck",
      slides: [
        {
          id: "source-slide",
          content: "",
          sourceRuntimeRequired: true,
          notes: "",
          layout: "content",
        },
      ],
    } as SharedDeckResponse;

    render(
      tree("/p/deck-live", {
        initialDeck: sourceDeck,
        sourceDeckId: "deck-live",
      }),
    );

    expect(
      screen.getByRole("button", { name: "editorExport.exportPdf" }),
    ).toBeTruthy();
    expect(mocks.renderQueries).toContainEqual(
      expect.objectContaining({ action: "get-slide-render", enabled: true }),
    );

    cleanup();
    mocks.renderQueries = [];

    render(snapshotTree("/share/snapshot-token", sourceDeck));

    expect(
      screen.getByRole("button", { name: "editorExport.exportPdf" }),
    ).toBeTruthy();
    expect(mocks.renderQueries).toContainEqual(
      expect.objectContaining({ action: "get-slide-render", enabled: false }),
    );
  });
});
