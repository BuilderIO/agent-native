// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  const initialSourceSlides = deck.slides.map((slide) => ({ ...slide }));
  const targetDeck = {
    id: "target-deck",
    title: "Target deck",
    aspectRatio: "16:9",
    slides: [
      {
        id: "target-slide",
        content: '<div data-source="legacy-content">Target slide</div>',
        notes: "",
      },
    ],
  };
  const collisionDeck = {
    id: "collision-deck",
    title: "Collision deck",
    aspectRatio: "16:9",
    slides: [
      {
        id: "slide-source-backed",
        content: "<div>Collision slide</div>",
        notes: "",
      },
    ],
  };
  const generationDeck = {
    id: "generation-deck",
    title: "Generating deck",
    aspectRatio: "16:9",
    generationContext: {
      originalPrompt: "Create two slides",
      generationAttemptId: "attempt-1",
      targetSlideCount: 2,
    },
    slides: [
      {
        id: "generation-real-slide",
        content: "<div>Generated content</div>",
        notes: "",
      },
      {
        id: "generation-blank-slide",
        content: '<div class="fmd-slide"></div>',
        notes: "",
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
  const accessStatus = {
    exists: true,
    hasAccess: true,
    signedIn: true,
    viewerEmail: "slides-2-owner@example.test",
    viewerName: "Slides 2 owner",
    role: "owner" as const,
    visibility: "private" as const,
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
  const targetSource = {
    deck: { id: targetDeck.id, title: targetDeck.title },
    slide: {
      id: "target-slide",
      deckId: targetDeck.id,
      position: 0,
      sourceTsx:
        "export default function Slide() { return <main>Target canonical source TSX</main>; }",
      revision: 1,
      sourceHash: "c".repeat(64),
      notes: "",
    },
  };
  const collisionSource = {
    deck: { id: collisionDeck.id, title: collisionDeck.title },
    slide: {
      id: "slide-source-backed",
      deckId: collisionDeck.id,
      position: 0,
      sourceTsx:
        "export default function Slide() { return <main>Collision deck canonical source TSX</main>; }",
      revision: 4,
      sourceHash: "e".repeat(64),
      notes: "",
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
  const targetRenderArtifact = {
    ...renderArtifact,
    deckId: targetDeck.id,
    slideId: targetSource.slide.id,
    revision: targetSource.slide.revision,
    sourceHash: targetSource.slide.sourceHash,
    html: '<main data-rendered="target">Target artifact</main>',
    runtime: { bundle: "target-source-runtime" },
  };
  const collisionRenderArtifact = {
    ...renderArtifact,
    deckId: collisionDeck.id,
    slideId: collisionSource.slide.id,
    revision: collisionSource.slide.revision,
    sourceHash: collisionSource.slide.sourceHash,
    html: '<main data-rendered="collision">Collision deck artifact</main>',
    runtime: { bundle: "collision-source-runtime" },
  };

  return {
    deck,
    initialSourceSlides,
    targetDeck,
    collisionDeck,
    generationDeck,
    initialTargetSlides: [...targetDeck.slides],
    legacyContent,
    source,
    accessStatus,
    secondSource,
    targetSource,
    collisionSource,
    pastedSlideId: null as string | null,
    failSourceSlideDelete: false,
    latestSource: null as typeof source | null,
    deckLoading: false,
    generationIsNewDeckCreation: false,
    generationPhase: "settled" as string,
    generationActive: false,
    generationRunError: false,
    sourceReadbackCount: 0,
    sourceReadCalls: [] as Array<{
      action: string;
      args: Record<string, unknown>;
    }>,
    nextSourceReadback: null as Promise<unknown> | null,
    updateSourceError: null as unknown,
    renderArtifact,
    secondRenderArtifact,
    targetRenderArtifact,
    collisionRenderArtifact,
    actionQueries: [] as Array<{
      action: string;
      args: Record<string, unknown>;
      enabled?: boolean;
    }>,
    mutationCalls: [] as Array<{ action: string; args: unknown }>,
    deckQueryError: null as Error | null,
    clientAppState: {} as Record<string, unknown>,
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
  callActionWithRetry: async (
    action: string,
    args: Record<string, unknown>,
  ) => {
    if (action !== "get-slide-source") {
      throw new Error(`Unexpected imperative page action: ${action}`);
    }
    mocks.sourceReadbackCount += 1;
    mocks.sourceReadCalls.push({ action, args });
    if (mocks.nextSourceReadback) {
      const readback = mocks.nextSourceReadback;
      mocks.nextSourceReadback = null;
      return readback;
    }
    const deckId = args.deckId;
    const slideId = args.slideId;
    const latestSource = mocks.latestSource;
    if (
      latestSource &&
      latestSource.slide.deckId === deckId &&
      latestSource.slide.id === slideId
    ) {
      return latestSource;
    }
    if (deckId === mocks.collisionDeck.id) return mocks.collisionSource;
    if (slideId === mocks.secondSource.slide.id) return mocks.secondSource;
    if (slideId === mocks.targetSource.slide.id) return mocks.targetSource;
    if (slideId === mocks.pastedSlideId) {
      return {
        deck: mocks.targetSource.deck,
        slide: {
          ...mocks.targetSource.slide,
          id: slideId,
          position: mocks.targetDeck.slides.findIndex(
            ({ id }) => id === slideId,
          ),
        },
      };
    }
    return mocks.source;
  },
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
        return { data, isError: false };
      },
    });

    switch (action) {
      case "get-deck":
        if (mocks.deckQueryError) {
          return {
            data: undefined,
            error: mocks.deckQueryError,
            isError: true,
            isLoading: false,
            refetch: async () => ({
              data: undefined,
              error: mocks.deckQueryError,
              isError: true,
            }),
          };
        }
        return result(
          mocks.deckLoading
            ? undefined
            : args.id === mocks.targetDeck.id
              ? mocks.targetDeck
              : args.id === mocks.generationDeck.id
                ? mocks.generationDeck
                : args.id === mocks.collisionDeck.id
                  ? mocks.collisionDeck
                  : mocks.deck,
          mocks.deckLoading,
        );
      case "get-deck-access-status":
        return result(mocks.accessStatus);
      case "get-slide-source":
        return result(
          args.deckId === mocks.collisionDeck.id
            ? mocks.collisionSource
            : args.slideId === mocks.pastedSlideId
              ? {
                  deck: mocks.targetSource.deck,
                  slide: {
                    ...mocks.targetSource.slide,
                    id: mocks.pastedSlideId,
                    position: mocks.targetDeck.slides.findIndex(
                      ({ id }) => id === mocks.pastedSlideId,
                    ),
                  },
                }
              : args.slideId === mocks.targetSource.slide.id
                ? mocks.targetSource
                : args.slideId === mocks.secondSource.slide.id
                  ? mocks.secondSource
                  : mocks.source,
        );
      case "get-slide-render":
        {
          const latestSource = mocks.latestSource;
          if (
            latestSource &&
            latestSource.slide.deckId === args.deckId &&
            latestSource.slide.id === args.slideId &&
            args.expectedRevision === latestSource.slide.revision &&
            args.expectedSourceHash === latestSource.slide.sourceHash
          ) {
            return result({
              ...mocks.renderArtifact,
              revision: latestSource.slide.revision,
              sourceHash: latestSource.slide.sourceHash,
              html: '<main data-rendered="updated">Updated source artifact</main>',
            });
          }
        }
        if (args.deckId === mocks.collisionDeck.id) {
          return result(mocks.collisionRenderArtifact);
        }
        return result(
          args.slideId === mocks.pastedSlideId
            ? {
                ...mocks.targetRenderArtifact,
                slideId: mocks.pastedSlideId,
                revision: 1,
                sourceHash: "c".repeat(64),
              }
            : args.slideId === mocks.targetRenderArtifact.slideId
              ? mocks.targetRenderArtifact
              : args.slideId === mocks.secondRenderArtifact.slideId
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
    mutateAsync: async (args: unknown) => {
      mocks.mutationCalls.push({ action, args });
      if (action === "update-slide-source" && mocks.updateSourceError) {
        throw mocks.updateSourceError;
      }
      if (action === "update-slide-source") {
        const input = args as {
          deckId: string;
          expectedRevision: number;
          slideId: string;
          sourceTsx?: string;
        };
        if (typeof input.sourceTsx === "string") {
          const saved = {
            ...mocks.source.slide,
            id: input.slideId,
            deckId: input.deckId,
            sourceTsx: input.sourceTsx,
            revision: input.expectedRevision + 1,
            sourceHash: "d".repeat(64),
          };
          mocks.latestSource = { deck: mocks.source.deck, slide: saved };
          return {
            revision: saved.revision,
            sourceHash: saved.sourceHash,
          };
        }
      }
      if (action === "patch-deck") {
        const input = args as {
          deckId: string;
          operations: Array<{
            op: string;
            slideId?: string;
            orderedIds?: string[];
          }>;
        };
        const target =
          input.deckId === mocks.targetDeck.id ? mocks.targetDeck : mocks.deck;
        const deletedSlideIds: string[] = [];
        for (const operation of input.operations) {
          if (operation.op === "delete-slide") {
            if (input.deckId === mocks.deck.id && mocks.failSourceSlideDelete) {
              throw new Error("source delete failed");
            }
            if (!operation.slideId) continue;
            const before = target.slides.length;
            target.slides = target.slides.filter(
              ({ id }) => id !== operation.slideId,
            );
            if (target.slides.length < before) {
              deletedSlideIds.push(operation.slideId);
            }
          } else if (operation.op === "reorder-slides") {
            target.slides = (operation.orderedIds ?? []).flatMap((slideId) => {
              const slide = target.slides.find(
                (candidate) => candidate.id === slideId,
              );
              return slide ? [slide] : [];
            });
          }
        }
        return { ok: true, deletedSlideIds, updatedSlideIds: [] };
      }
      if (action === "copy-slide-to-deck") {
        const input = args as {
          targetDeckId: string;
          slideId: string;
          afterSlideId?: string;
        };
        if (input.targetDeckId === mocks.targetDeck.id) {
          const afterIndex = input.afterSlideId
            ? mocks.targetDeck.slides.findIndex(
                ({ id }) => id === input.afterSlideId,
              )
            : mocks.targetDeck.slides.length - 1;
          mocks.targetDeck.slides.splice(afterIndex + 1, 0, {
            id: input.slideId,
            content: "Pasted slide",
            notes: "",
          });
          mocks.pastedSlideId = input.slideId;
          return {
            deckId: input.targetDeckId,
            slideId: input.slideId,
            updatedAt: "2026-10-20T00:00:00.000Z",
            updatedSlideIds: [input.slideId],
          };
        }
      }
      return {};
    },
    mutate: () => {},
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: async (key: string) => mocks.clientAppState[key] ?? null,
  writeClientAppState: async (
    key: string,
    value: unknown,
    options?: { keepalive?: boolean; requestSource?: string },
  ) => {
    mocks.appStateWrites.push({ key, value, options });
    mocks.clientAppState[key] = value;
    return value;
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

vi.mock("@/components/slides-2-editor/Slides2Editor", () => ({
  DEFAULT_SLIDE_RAIL_WIDTH: 271,
  Slides2Editor: (props: Record<string, unknown>) => {
    mocks.editorProps = props;
    return null;
  },
  SLIDE_RAIL_WIDTH_STATE_KEY: "slides-2-editor-rail-width",
  readSlideRailWidth: () => null,
}));

vi.mock("@/hooks/use-agent-generating", () => ({
  getStartedGenerationAttemptTabId: () => null,
}));

vi.mock("@/hooks/use-new-deck-generation", () => ({
  clearNewDeckGenerationRun: () => {},
  useNewDeckGeneration: () => ({
    isNewDeckCreation: mocks.generationIsNewDeckCreation,
    phase: mocks.generationPhase,
  }),
  useNewDeckGenerationRun: () => ({
    generating: mocks.generationActive,
    submitMessageId: null,
    tabId: null,
    conversationThreadId: null,
    questionContinuationPending: false,
    submitQuestionContinuation: () => {},
  }),
}));

vi.mock("@/hooks/use-new-deck-generation-signal", () => ({
  useNewDeckGenerationSignal: () => ({
    attempt: { runError: mocks.generationRunError },
    generating: mocks.generationActive,
  }),
}));

import type { SlideTextRangeSelection } from "@shared/slide-text-range-selection";

import { getEditorActionErrorTranslationKey } from "@/components/slides-2-editor/editor-action-errors";
import type {
  ElementSnapshot,
  SourceEdit,
} from "@/components/slides-2-editor/types";

import Slides2EditorPage from "./Slides2EditorPage";

afterEach(cleanup);

beforeEach(() => {
  mocks.actionQueries.length = 0;
  mocks.mutationCalls.length = 0;
  mocks.appStateWrites.length = 0;
  mocks.clientAppState = {};
  mocks.editorProps = null;
  mocks.targetDeck.slides = [...mocks.initialTargetSlides];
  mocks.deck.slides = mocks.initialSourceSlides.map((slide) => ({ ...slide }));
  mocks.pastedSlideId = null;
  mocks.failSourceSlideDelete = false;
  mocks.latestSource = null;
  mocks.deckLoading = false;
  mocks.generationIsNewDeckCreation = false;
  mocks.generationPhase = "settled";
  mocks.generationActive = false;
  mocks.generationRunError = false;
  mocks.sourceReadbackCount = 0;
  mocks.sourceReadCalls.length = 0;
  mocks.nextSourceReadback = null;
  mocks.updateSourceError = null;
  mocks.deckQueryError = null;
  mocks.accessStatus.hasAccess = true;
});

describe("Slides2EditorPage source-backed loading", () => {
  it("does not settle generation with blank placeholders counted as slides", async () => {
    mocks.generationIsNewDeckCreation = true;
    mocks.generationPhase = "started";
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      {
        initialEntries: [
          "/deck/generation-deck?generating=1&generation_attempt_id=attempt-1&generationSubmitId=submit-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "deckEditor.generationOutcomeUnresolvedWithSlides",
      );
    });
  });

  it("clears a same-attempt failure after a later successful settlement", async () => {
    mocks.generationIsNewDeckCreation = true;
    mocks.generationPhase = "abandoned";
    mocks.generationRunError = true;
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      {
        initialEntries: [
          "/deck/generation-deck?generating=1&generation_attempt_id=attempt-1&generationSubmitId=submit-1",
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "deckEditor.agentRunFailed",
      );
    });

    mocks.generationDeck.slides = [
      {
        id: "generation-real-slide",
        content: "<div>Generated content</div>",
        notes: "",
      },
      {
        id: "generation-second-slide",
        content: "<div>Second generated slide</div>",
        notes: "",
      },
    ];
    mocks.generationRunError = false;
    mocks.generationPhase = "started";

    await act(async () => {
      await router.navigate(
        "/deck/generation-deck?generating=1&generation_attempt_id=attempt-1&generationSubmitId=submit-2",
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("keeps the loading shell while the deck has no active slide yet", () => {
    mocks.deckLoading = true;
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    const { container } = render(<RouterProvider router={router} />);

    expect(container.querySelector(".skeleton-shimmer")).not.toBeNull();
    expect(mocks.editorProps).toBeNull();
  });

  it("passes canonical slide source and its render artifact to the editor", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
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

    const accessQuery = mocks.actionQueries.find(
      ({ action }) => action === "get-deck-access-status",
    );
    expect(accessQuery).toMatchObject({
      args: { deckId: "deck-source-backed" },
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

  it("does not reuse a saved source when another deck reuses the slide id", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    await act(async () => {
      await (
        mocks.editorProps?.onRestore as (
          sourceTsx: string,
          expected: { revision: number; sourceHash: string },
        ) => Promise<unknown>
      )(
        mocks.source.slide.sourceTsx.replace(
          "Canonical source TSX",
          "Saved deck A source TSX",
        ),
        { revision: 4, sourceHash: "a".repeat(64) },
      );
    });

    await waitFor(() =>
      expect(mocks.editorProps?.source).toMatchObject({
        deckId: "deck-source-backed",
        revision: 5,
        sourceTsx: expect.stringContaining("Saved deck A source TSX"),
      }),
    );

    await act(async () => {
      await router.navigate("/deck/collision-deck");
    });

    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        deckId: "collision-deck",
        source: mocks.collisionSource.slide,
        artifact: mocks.collisionRenderArtifact,
      }),
    );

    await act(async () => {
      await router.navigate("/deck/deck-source-backed");
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        deckId: "deck-source-backed",
        source: expect.objectContaining({ revision: 5 }),
      }),
    );

    mocks.updateSourceError = Object.assign(new Error("source changed"), {
      errorCode: "slide_source_conflict",
    });
    await act(async () => {
      await expect(
        (mocks.editorProps?.onSave as (edits: unknown[]) => Promise<unknown>)(
          [],
        ),
      ).rejects.toMatchObject({ errorCode: "slide_source_conflict" });
    });
    mocks.updateSourceError = null;

    await act(async () => {
      await router.navigate("/deck/collision-deck");
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        deckId: "collision-deck",
        source: mocks.collisionSource.slide,
        artifact: mocks.collisionRenderArtifact,
      }),
    );
  });

  it("uses a denied private-deck access result to show the request flow", async () => {
    mocks.deckQueryError = new Error("private deck");
    mocks.accessStatus.hasAccess = false;
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", {
        name: "deckAccessPage.noAccessTitle",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "deckEditor.requestAccess" }),
    ).toBeTruthy();
    expect(screen.getByText("slides-2-owner@example.test")).toBeTruthy();
    expect(mocks.editorProps).toBeNull();
    expect(
      mocks.actionQueries.find(
        ({ action }) => action === "get-deck-access-status",
      ),
    ).toMatchObject({
      args: { deckId: "deck-source-backed" },
      enabled: true,
    });
  });

  it("persists a source-backed motion replacement and reads back its render identity", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const sourceTsx = mocks.source.slide.sourceTsx.replace(
      "Canonical source TSX",
      "Motion metadata source TSX",
    );
    await act(async () => {
      await (
        mocks.editorProps?.onRestore as (
          sourceTsx: string,
          expected: { revision: number; sourceHash: string },
        ) => Promise<unknown>
      )(sourceTsx, {
        revision: mocks.source.slide.revision,
        sourceHash: mocks.source.slide.sourceHash,
      });
    });

    expect(mocks.mutationCalls).toContainEqual({
      action: "update-slide-source",
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed",
        expectedRevision: 4,
        expectedSourceHash: "a".repeat(64),
        sourceTsx,
      },
    });
    expect(mocks.sourceReadbackCount).toBe(1);
    expect(mocks.latestSource?.slide).toMatchObject({
      sourceTsx,
      revision: 5,
      sourceHash: "d".repeat(64),
    });

    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: {
          sourceTsx,
          revision: 5,
          sourceHash: "d".repeat(64),
        },
        artifact: {
          revision: 5,
          sourceHash: "d".repeat(64),
          html: '<main data-rendered="updated">Updated source artifact</main>',
        },
      }),
    );
    expect(
      mocks.actionQueries
        .filter(({ action }) => action === "get-slide-render")
        .at(-1),
    ).toMatchObject({
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed",
        expectedRevision: 5,
        expectedSourceHash: "d".repeat(64),
      },
      enabled: true,
    });
  });

  it("reads back the saved slide by identity if selection changes during restore", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    let resolveReadback = (_value: unknown) => {};
    mocks.nextSourceReadback = new Promise<unknown>((resolve) => {
      resolveReadback = resolve;
    });
    let restorePromise: Promise<unknown> | undefined;
    await act(async () => {
      restorePromise = (
        mocks.editorProps?.onRestore as (
          sourceTsx: string,
          expected: { revision: number; sourceHash: string },
        ) => Promise<unknown>
      )(
        mocks.source.slide.sourceTsx.replace(
          "Canonical source TSX",
          "Restored source TSX",
        ),
        { revision: 4, sourceHash: "a".repeat(64) },
      );
    });

    await waitFor(() => expect(mocks.sourceReadCalls).toHaveLength(1));
    expect(mocks.sourceReadCalls[0]).toEqual({
      action: "get-slide-source",
      args: {
        deckId: "deck-source-backed",
        slideId: "slide-source-backed",
      },
    });

    await act(async () => {
      (mocks.editorProps?.onSelectSlide as (index: number) => void)(1);
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.secondSource.slide,
        artifact: mocks.secondRenderArtifact,
      }),
    );

    await act(async () => {
      resolveReadback(mocks.latestSource);
      await expect(restorePromise).resolves.toMatchObject({
        id: "slide-source-backed",
        revision: 5,
        sourceTsx: expect.stringContaining("Restored source TSX"),
      });
    });
    expect(mocks.editorProps).toMatchObject({
      source: mocks.secondSource.slide,
      artifact: mocks.secondRenderArtifact,
    });
  });

  it("saves deck title changes through patch-deck", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    await act(async () => {
      await (
        mocks.editorProps?.onTitleChange as (title: string) => Promise<void>
      )("Updated deck title");
    });

    expect(mocks.mutationCalls).toContainEqual({
      action: "patch-deck",
      args: {
        deckId: "deck-source-backed",
        operations: [
          {
            op: "patch-deck-fields",
            fields: { title: "Updated deck title" },
          },
        ],
      },
    });
    expect(mocks.editorProps?.title).toBe("Updated deck title");
  });

  it("keeps the copied slide reference in application state across decks", async () => {
    const router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <Slides2EditorPage /> },
        { path: "/home", element: <div>Home</div> },
      ],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    await act(async () => {
      await (
        mocks.editorProps?.onCopySlide as (slideId: string) => Promise<void>
      )("slide-source-backed");
    });
    expect(mocks.appStateWrites.at(-1)).toMatchObject({
      key: "slides-2:slide-transfer-clipboard",
      value: {
        sourceDeckId: "deck-source-backed",
        sourceSlideId: "slide-source-backed",
      },
    });

    await act(async () => {
      await router.navigate("/home");
      await router.navigate("/deck/target-deck");
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        deckId: "target-deck",
        canPasteSlide: true,
      }),
    );

    await act(async () => {
      await (
        mocks.editorProps?.onPasteSlide as (
          afterSlideId?: string,
        ) => Promise<void>
      )("target-slide");
    });

    expect(mocks.mutationCalls).toContainEqual({
      action: "copy-slide-to-deck",
      args: {
        sourceDeckId: "deck-source-backed",
        sourceSlideId: "slide-source-backed",
        targetDeckId: "target-deck",
        afterSlideId: "target-slide",
        slideId: mocks.pastedSlideId,
      },
    });
    await waitFor(() => {
      expect(router.state.location.search).toContain("p=2");
      expect(mocks.editorProps?.source).toMatchObject({
        id: mocks.pastedSlideId,
      });
    });
  });

  it("cuts a slide only after its cross-deck copy has been persisted", async () => {
    const router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <Slides2EditorPage /> },
        { path: "/home", element: <div>Home</div> },
      ],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    await act(async () => {
      await (
        mocks.editorProps?.onCutSlide as (slideId: string) => Promise<void>
      )("slide-source-backed");
    });
    expect(mocks.appStateWrites.at(-1)).toMatchObject({
      key: "slides-2:slide-transfer-clipboard",
      value: {
        sourceDeckId: "deck-source-backed",
        sourceSlideId: "slide-source-backed",
        operation: "cut",
      },
    });

    await act(async () => {
      await router.navigate("/home");
      await router.navigate("/deck/target-deck");
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        deckId: "target-deck",
        canPasteSlide: true,
        clipboardOperation: "cut",
      }),
    );

    await act(async () => {
      await (
        mocks.editorProps?.onPasteSlide as (
          afterSlideId?: string,
        ) => Promise<void>
      )("target-slide");
    });

    expect(mocks.mutationCalls).toContainEqual({
      action: "patch-deck",
      args: {
        deckId: "deck-source-backed",
        operations: [{ op: "delete-slide", slideId: "slide-source-backed" }],
      },
    });
    expect(
      mocks.deck.slides.some(({ id }) => id === "slide-source-backed"),
    ).toBe(false);
    expect(
      mocks.appStateWrites
        .filter(({ key }) => key === "slides-2:slide-transfer-clipboard")
        .at(-1),
    ).toMatchObject({
      key: "slides-2:slide-transfer-clipboard",
      value: null,
    });
    await waitFor(() => expect(router.state.location.search).toContain("p=2"));
  });

  it("moves a cut slide within its deck and clears the clipboard", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    await act(async () => {
      await (
        mocks.editorProps?.onCutSlide as (slideId: string) => Promise<void>
      )("slide-source-backed");
    });
    await act(async () => {
      await (
        mocks.editorProps?.onPasteSlide as (
          afterSlideId?: string,
        ) => Promise<void>
      )("slide-source-backed-2");
    });

    expect(mocks.mutationCalls).toContainEqual({
      action: "patch-deck",
      args: {
        deckId: "deck-source-backed",
        operations: [
          {
            op: "reorder-slides",
            orderedIds: ["slide-source-backed-2", "slide-source-backed"],
          },
        ],
      },
    });
    expect(mocks.deck.slides.map(({ id }) => id)).toEqual([
      "slide-source-backed-2",
      "slide-source-backed",
    ]);
    expect(
      mocks.appStateWrites
        .filter(({ key }) => key === "slides-2:slide-transfer-clipboard")
        .at(-1),
    ).toMatchObject({
      key: "slides-2:slide-transfer-clipboard",
      value: null,
    });
  });

  it("keeps both decks safe when the source delete fails after a cut paste", async () => {
    mocks.failSourceSlideDelete = true;
    const router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <Slides2EditorPage /> },
        { path: "/home", element: <div>Home</div> },
      ],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());
    await act(async () => {
      await (
        mocks.editorProps?.onCutSlide as (slideId: string) => Promise<void>
      )("slide-source-backed");
    });
    await act(async () => {
      await router.navigate("/home");
      await router.navigate("/deck/target-deck");
    });
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({ deckId: "target-deck" }),
    );

    await act(async () => {
      await (
        mocks.editorProps?.onPasteSlide as (
          afterSlideId?: string,
        ) => Promise<void>
      )("target-slide");
    });

    expect(
      mocks.deck.slides.some(({ id }) => id === "slide-source-backed"),
    ).toBe(true);
    expect(
      mocks.targetDeck.slides.some(({ id }) => id === mocks.pastedSlideId),
    ).toBe(true);
    expect(
      mocks.appStateWrites
        .filter(({ key }) => key === "slides-2:slide-transfer-clipboard")
        .at(-1),
    ).toMatchObject({
      key: "slides-2:slide-transfer-clipboard",
      value: null,
    });
  });

  it("cuts the focused thumbnail with the editor's command-X shortcut", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());
    const thumbnail = document.createElement("button");
    thumbnail.setAttribute("data-slides-2-thumbnail-index", "0");
    document.body.append(thumbnail);
    thumbnail.focus();
    const shortcut = new KeyboardEvent("keydown", {
      key: "x",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      thumbnail.dispatchEvent(shortcut);
    });

    expect(shortcut.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(mocks.appStateWrites.at(-1)).toMatchObject({
        value: {
          sourceDeckId: "deck-source-backed",
          sourceSlideId: "slide-source-backed",
          operation: "cut",
        },
      }),
    );
    thumbnail.remove();
  });

  it("warns before leaving while source edits are unsaved", async () => {
    const router = createMemoryRouter(
      [
        { path: "/deck/:id", element: <Slides2EditorPage /> },
        { path: "/home", element: <div>Home</div> },
      ],
      { initialEntries: ["/deck/deck-source-backed"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const history = mocks.editorProps?.crossSlideHistory as {
      append: (edits: SourceEdit[]) => void;
    };
    act(() =>
      history.append([
        {
          line: 1,
          column: 48,
          ops: [
            { kind: "set-text", value: "Changed title", prevText: "Title" },
          ],
        },
      ]),
    );

    await act(async () => {
      await router.navigate("/home");
    });

    expect(router.state.location.pathname).toBe("/deck/deck-source-backed");
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "deckEditor.keepEditing" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await act(async () => {
      await router.navigate("/home");
    });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "deckEditor.leaveWithoutSaving" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
  });

  it("preserves editor view preferences when the active slide changes", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed?p=1"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    act(() => {
      (mocks.editorProps?.onZoomChange as (zoom: number) => void)(1.4);
      (mocks.editorProps?.onSlideRailWidthChange as (width: number) => void)(
        360,
      );
      (
        mocks.editorProps?.onActivePanelChange as (
          panel: "format" | "design" | "notes",
        ) => void
      )("notes");
      (mocks.editorProps?.onInspectorOpenChange as (open: boolean) => void)(
        false,
      );
      (
        mocks.editorProps?.onInspectorBeforePreviewChange as (
          open: boolean | null,
        ) => void
      )(false);
      (
        mocks.editorProps?.onInspectorToggledInPreviewChange as (
          toggled: boolean,
        ) => void
      )(true);
      (mocks.editorProps?.onOverviewOpenChange as (open: boolean) => void)(
        true,
      );
    });

    expect(mocks.editorProps).toMatchObject({
      zoom: 1.4,
      slideRailWidth: 360,
      activePanel: "notes",
      previousPanel: "notes",
      inspectorOpen: false,
      inspectorBeforePreview: false,
      inspectorToggledInPreview: true,
      overviewOpen: true,
    });

    await act(async () => {
      await router.navigate("/deck/deck-source-backed?p=2");
    });

    await waitFor(() =>
      expect(mocks.editorProps?.source).toMatchObject({
        id: mocks.secondSource.slide.id,
      }),
    );
    expect(mocks.editorProps).toMatchObject({
      zoom: 1.4,
      slideRailWidth: 360,
      activePanel: "notes",
      previousPanel: "notes",
      inspectorOpen: false,
      inspectorBeforePreview: false,
      inspectorToggledInPreview: true,
      overviewOpen: true,
    });
  });

  it("keeps undo history available across slide navigation", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
      { initialEntries: ["/deck/deck-source-backed?p=1"] },
    );

    render(<RouterProvider router={router} />);
    await waitFor(() => expect(mocks.editorProps).not.toBeNull());

    const edits: SourceEdit[] = [
      {
        line: 1,
        column: 48,
        ops: [{ kind: "set-text", value: "Changed title", prevText: "Title" }],
      },
    ];
    const history = () =>
      mocks.editorProps?.crossSlideHistory as {
        append: (edits: SourceEdit[]) => void;
        undo: () => boolean | Promise<boolean>;
        canUndo: boolean;
        canRedo: boolean;
        editBatches: SourceEdit[][];
        historyIndex: number;
      };

    act(() => history().append(edits));
    await waitFor(() =>
      expect(history()).toMatchObject({
        canUndo: true,
        editBatches: [edits],
        historyIndex: 1,
      }),
    );

    await act(async () => {
      await router.navigate("/deck/deck-source-backed?p=2");
    });
    await waitFor(() =>
      expect(mocks.editorProps?.source).toMatchObject({
        id: mocks.secondSource.slide.id,
      }),
    );
    expect(history()).toMatchObject({
      canUndo: true,
      editBatches: [],
      historyIndex: 0,
    });

    await act(async () => {
      expect(await history().undo()).toBe(true);
    });
    await waitFor(() => {
      expect(router.state.location.search).toContain("p=1");
      expect(mocks.editorProps?.source).toMatchObject({
        id: mocks.source.slide.id,
      });
    });
    expect(history()).toMatchObject({
      canUndo: false,
      canRedo: true,
      editBatches: [edits],
      historyIndex: 0,
    });
  });

  it("persists only current selected text ranges in tab-scoped selection state", async () => {
    const router = createMemoryRouter(
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
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
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
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
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
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
      [{ path: "/deck/:id", element: <Slides2EditorPage /> }],
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
    expect(mocks.sourceReadbackCount).toBe(1);
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
    expect(mocks.sourceReadbackCount).toBe(2);
    await waitFor(() =>
      expect(mocks.editorProps).toMatchObject({
        source: mocks.latestSource?.slide,
        sourceConflict: false,
      }),
    );
  });
});
