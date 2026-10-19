// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sourceHash = "a".repeat(64);
  const legacyContent =
    '<div data-source="legacy-content">Legacy preview decoy</div>';

  const deck = {
    id: "deck-source-backed",
    title: "Persisted source-backed deck",
    aspectRatio: "16:9",
    slides: [
      {
        id: "slide-source-backed",
        content: legacyContent,
        notes: "Persisted notes",
      },
      {
        id: "slide-source-backed-2",
        content: '<div data-source="legacy-content">Second slide decoy</div>',
        notes: "Second slide notes",
      },
    ],
  };
  const source = {
    deck: { id: deck.id, title: deck.title },
    slide: {
      id: "slide-source-backed",
      deckId: deck.id,
      position: 0,
      sourceTsx:
        "export default function Slide() { return <main>Canonical source TSX</main>; }",
      revision: 4,
      sourceHash,
      notes: "Persisted notes",
    },
  };
  const secondSource = {
    deck: { id: deck.id, title: deck.title },
    slide: {
      id: "slide-source-backed-2",
      deckId: deck.id,
      position: 1,
      sourceTsx:
        "export default function Slide() { return <main>Second canonical source TSX</main>; }",
      revision: 2,
      sourceHash: "b".repeat(64),
      notes: "Second slide notes",
    },
  };
  const renderArtifact = {
    protocolVersion: 1,
    deckId: deck.id,
    slideId: source.slide.id,
    revision: source.slide.revision,
    sourceHash,
    width: 1920,
    height: 1080,
    html: '<main data-rendered="canonical">Canonical rendered artifact</main>',
    assetOrigins: [],
    designTokens: {},
    runtime: { bundle: "canonical-source-runtime" },
  };
  const secondRenderArtifact = {
    ...renderArtifact,
    slideId: secondSource.slide.id,
    revision: secondSource.slide.revision,
    sourceHash: secondSource.slide.sourceHash,
    html: '<main data-rendered="second">Second canonical artifact</main>',
    runtime: { bundle: "second-source-runtime" },
  };

  return {
    deck,
    legacyContent,
    source,
    secondSource,
    latestSource: null as typeof source | null,
    deckLoading: false,
    sourceRefetchCount: 0,
    updateSourceError: null as unknown,
    renderArtifact,
    secondRenderArtifact,
    actionQueries: [] as Array<{
      action: string;
      args: Record<string, unknown>;
      enabled?: boolean;
    }>,
    appStateWrites: [] as Array<{
      key: string;
      value: unknown;
      options?: { keepalive?: boolean; requestSource?: string };
    }>,
    editorProps: null as Record<string, unknown> | null,
  };
});

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  getBrowserTabId: () => "editor-source-render-test",
  useActionQuery: (
    action: string,
    args: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    mocks.actionQueries.push({ action, args, enabled: options?.enabled });
    const result = (data: unknown, isLoading = false) => ({
      data,
      error: undefined,
      isError: false,
      isLoading,
      refetch: async () => {
        if (action === "get-slide-source") {
          mocks.sourceRefetchCount += 1;
          return {
            data: mocks.latestSource ?? data,
            isError: false,
          };
        }
        return { data, isError: false };
      },
    });

    switch (action) {
      case "get-deck":
        return result(
          mocks.deckLoading ? undefined : mocks.deck,
          mocks.deckLoading,
        );
      case "get-slide-source":
        return result(
          args.slideId === mocks.secondSource.slide.id
            ? mocks.secondSource
            : mocks.source,
        );
      case "get-slide-render":
        return result(
          args.slideId === mocks.secondRenderArtifact.slideId
            ? mocks.secondRenderArtifact
            : mocks.renderArtifact,
        );
      case "get-deck-design-tokens":
        return result(undefined);
      default:
        throw new Error(`Unexpected page action query: ${action}`);
    }
  },
  useActionMutation: (action: string) => ({
    mutateAsync: async () => {
      if (action === "update-slide-source" && mocks.updateSourceError) {
        throw mocks.updateSourceError;
      }
      return {};
    },
    mutate: () => {},
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState: async (
    key: string,
    value: unknown,
    options?: { keepalive?: boolean; requestSource?: string },
  ) => {
    mocks.appStateWrites.push({ key, value, options });
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app/chat/agentkit-chat", () => ({
  useGuidedQuestionFlow: () => ({
    questions: [],
    title: undefined,
    description: undefined,
    skipLabel: undefined,
    submitLabel: undefined,
    isSubmissionBlocked: false,
    providerStatus: undefined,
    retryProviderStatus: () => {},
    handleSubmit: () => {},
    handleSkip: () => {},
    isSubmitting: false,
    refetchPendingQuestionStatus: async () => ({ status: "none" }),
  }),
}));

vi.mock("@/components/editor/QuestionFlow", () => ({
  QuestionFlow: () => null,
}));

vi.mock("@/components/open-slide-editor/OpenSlideEditor", () => ({
  OpenSlideEditor: (props: Record<string, unknown>) => {
    mocks.editorProps = props;
    return null;
  },
}));

vi.mock("@/hooks/use-agent-generating", () => ({
  getStartedGenerationAttemptTabId: () => null,
}));

vi.mock("@/hooks/use-new-deck-generation", () => ({
  clearNewDeckGenerationRun: () => {},
  useNewDeckGeneration: () => ({
    isNewDeckCreation: false,
    phase: "settled",
  }),
  useNewDeckGenerationRun: () => ({
    generating: false,
    submitMessageId: null,
    tabId: null,
    conversationThreadId: null,
    questionContinuationPending: false,
    submitQuestionContinuation: () => {},
  }),
}));

vi.mock("@/hooks/use-new-deck-generation-signal", () => ({
  useNewDeckGenerationSignal: () => ({
    attempt: { runError: false },
    generating: false,
  }),
}));

import type { SlideTextRangeSelection } from "@shared/slide-text-range-selection";

import { getEditorActionErrorTranslationKey } from "@/components/open-slide-editor/editor-action-errors";
import type { ElementSnapshot } from "@/components/open-slide-editor/types";

import OpenSlideEditorPage from "./OpenSlideEditorPage";

afterEach(cleanup);

beforeEach(() => {
  mocks.actionQueries.length = 0;
  mocks.appStateWrites.length = 0;
  mocks.editorProps = null;
  mocks.latestSource = null;
  mocks.deckLoading = false;
  mocks.sourceRefetchCount = 0;
  mocks.updateSourceError = null;
});

describe("OpenSlideEditorPage source-backed loading", () => {
  it("keeps the loading shell while the deck has no active slide yet", () => {
    mocks.deckLoading = true;
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    const { container } = render(<RouterProvider router={router} />);

    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
    expect(mocks.editorProps).toBeNull();
  });

  it("passes canonical slide source and its render artifact to the editor", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const deckQuery = mocks.actionQueries.find(
      ({ action }) => action === "get-deck",
    );
    expect(deckQuery).toMatchObject({
      args: { id: "deck-source-backed", compact: "true" },
      enabled: true,
    });

    const sourceQuery = mocks.actionQueries.find(
      ({ action }) => action === "get-slide-source",
    );
    expect(sourceQuery).toMatchObject({
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed",
      },
      enabled: true,
    });

    const renderQuery = mocks.actionQueries.find(
      ({ action }) => action === "get-slide-render",
    );
    expect(renderQuery).toMatchObject({
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed",
        expectedRevision: 4,
        expectedSourceHash: "a".repeat(64),
      },
      enabled: true,
    });

    expect(mocks.editorProps).toMatchObject({
      deckId: "deck-source-backed",
      source: mocks.source.slide,
      artifact: mocks.renderArtifact,
    });
    expect(mocks.editorProps?.source).not.toMatchObject({
      content: mocks.legacyContent,
    });
    expect(
      (mocks.editorProps?.source as { sourceTsx: string }).sourceTsx,
    ).toContain("Canonical source TSX");
    expect(mocks.editorProps?.artifact).toBe(mocks.renderArtifact);
    expect(mocks.editorProps?.slides).toEqual(mocks.deck.slides);
  });

  it("persists only current selected text ranges in tab-scoped selection state", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const selected: ElementSnapshot = {
      nodeId: "1:48:1",
      line: 1,
      column: 48,
      instanceIndex: 1,
      instanceCount: 2,
      tagName: "h1",
      bounds: { x: 10, y: 20, width: 300, height: 50 },
      text: "Opening",
      styles: {},
    };
    const textRange: SlideTextRangeSelection = {
      slideId: mocks.source.slide.id,
      sourceLine: selected.line,
      sourceColumn: selected.column,
      sourceRevision: mocks.source.slide.revision,
      sourceHash: mocks.source.slide.sourceHash,
      start: 0,
      end: 4,
      expectedText: "Opening",
    };
    const selectionChange = () =>
      mocks.editorProps?.onSelectionChange as (
        selected: ElementSnapshot[],
        textRange: SlideTextRangeSelection | null,
      ) => void;
    const tabSelectionKey =
      "slides-2:slides-selection:editor-source-render-test";

    await act(async () => selectionChange()([selected], textRange));

    expect(mocks.appStateWrites.at(-1)).toMatchObject({
      key: tabSelectionKey,
      options: { requestSource: "editor-source-render-test" },
      value: {
        deckId: mocks.deck.id,
        slideId: mocks.source.slide.id,
        sourceRevision: mocks.source.slide.revision,
        sourceHash: mocks.source.slide.sourceHash,
        items: [
          {
            sourceLine: selected.line,
            sourceColumn: selected.column,
            instanceIndex: 1,
            instanceCount: 2,
          },
        ],
        textRange,
      },
    });

    const differentSelection = { ...selected, nodeId: "subtitle", line: 2 };
    await act(async () => selectionChange()([differentSelection], textRange));
    expect(mocks.appStateWrites.at(-1)?.value).not.toHaveProperty("textRange");

    await act(async () => selectionChange()([selected], null));

    expect(mocks.appStateWrites.at(-1)).toMatchObject({
      key: tabSelectionKey,
      value: {
        slideId: mocks.source.slide.id,
        items: [
          {
            sourceLine: selected.line,
            sourceColumn: selected.column,
            instanceIndex: 1,
            instanceCount: 2,
          },
        ],
      },
    });
    expect(mocks.appStateWrites.at(-1)?.value).not.toHaveProperty("textRange");

    await act(async () => selectionChange()([selected], textRange));
    const selectSlide = mocks.editorProps?.onSelectSlide as (
      index: number,
    ) => void;
    await act(async () => selectSlide(1));
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.secondSource.slide,
        artifact: mocks.secondRenderArtifact,
      }),
    );

    const nextSelectionChange = mocks.editorProps?.onSelectionChange as (
      selected: ElementSnapshot[],
      textRange: SlideTextRangeSelection | null,
    ) => void;
    await act(async () => nextSelectionChange([], null));

    expect(mocks.appStateWrites.at(-1)).toMatchObject({
      key: tabSelectionKey,
      value: {
        slideId: mocks.secondSource.slide.id,
        sourceRevision: mocks.secondSource.slide.revision,
        sourceHash: mocks.secondSource.slide.sourceHash,
        items: [],
      },
    });
    expect(mocks.appStateWrites.at(-1)?.value).not.toHaveProperty("textRange");
  });

  it("writes the selected page as p and loads a p deep link", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const selectSlide = mocks.editorProps?.onSelectSlide as (
      index: number,
    ) => void;
    await act(async () => selectSlide(1));

    await waitFor(() => expect(router.state.location.search).toBe("?p=2"));
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.secondSource.slide,
        artifact: mocks.secondRenderArtifact,
      }),
    );

    const secondSourceQuery = mocks.actionQueries.find(
      ({ action, args }) =>
        action === "get-slide-source" &&
        args.slideId === mocks.secondSource.slide.id,
    );
    expect(secondSourceQuery).toMatchObject({
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed-2",
      },
      enabled: true,
    });
  });

  it("normalizes legacy slide query links to p", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed?slide=2"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(router.state.location.search).toBe("?p=2"));
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.secondSource.slide,
        artifact: mocks.secondRenderArtifact,
      }),
    );
  });

  it("preserves source conflicts and requires an explicit canonical reload", async () => {
    const conflict = Object.assign(new Error("source changed"), {
      errorCode: "slide_source_conflict",
    });
    mocks.updateSourceError = conflict;
    mocks.latestSource = {
      ...mocks.source,
      slide: {
        ...mocks.source.slide,
        sourceTsx:
          "export default function Slide() { return <main>Latest source TSX</main>; }",
        revision: 5,
        sourceHash: "b".repeat(64),
      },
    };

    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <OpenSlideEditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const save = mocks.editorProps?.onSave as (
      edits: unknown[],
    ) => Promise<unknown>;
    let saveError: unknown;
    await act(async () => {
      try {
        await save([]);
      } catch (error) {
        saveError = error;
      }
    });

    expect(saveError).toBe(conflict);
    expect(getEditorActionErrorTranslationKey(saveError)).toBe(
      "editorErrors.slideChanged",
    );
    expect(mocks.sourceRefetchCount).toBe(1);
    expect(mocks.editorProps).toMatchObject({
      source: mocks.source.slide,
      sourceConflict: true,
    });

    const reload = mocks.editorProps?.onReloadSource as () => Promise<unknown>;
    let reloaded: unknown;
    await act(async () => {
      reloaded = await reload();
    });

    expect(reloaded).toEqual(mocks.latestSource?.slide);
    expect(mocks.sourceRefetchCount).toBe(2);
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.latestSource?.slide,
        sourceConflict: false,
      }),
    );
  });
});
