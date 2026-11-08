// @vitest-environment happy-dom

import type {
  ResourceSuggestion,
  SuggestionOperation,
} from "@agent-native/core/review";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProposal: vi.fn(),
  updateSuggestion: vi.fn(),
  decideSuggestion: vi.fn(),
  decideProposal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
}));
vi.mock("@agent-native/core/client/review", () => ({
  useCreateResourceSuggestionProposal: () => ({
    mutateAsync: mocks.createProposal,
  }),
  useUpdateResourceSuggestion: () => ({ mutateAsync: mocks.updateSuggestion }),
  useDecideResourceSuggestion: () => ({ mutateAsync: mocks.decideSuggestion }),
  useDecideResourceSuggestionProposal: () => ({
    mutateAsync: mocks.decideProposal,
  }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: vi.fn() },
}));

import { CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER } from "@shared/blocks-field-suggestions";

import { useBlocksFieldSuggestions } from "./blocks-field-suggestion-sessions";

type Sessions = ReturnType<typeof useBlocksFieldSuggestions>;

function savedSuggestion(
  id: string,
  operations: SuggestionOperation[],
  baseRevision: string,
): ResourceSuggestion {
  return {
    id,
    proposalId: "proposal-1",
    revision: 1,
    resourceType: "document",
    resourceId: "doc-1",
    adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
    adapterVersion: 1,
    threadId: `suggestion-${id}`,
    authorEmail: "suggester@example.test",
    actorKind: "human",
    baseRevision,
    status: "pending",
    summary: "editor.toolbar.suggestEdits",
    ownerEmail: "owner@example.test",
    orgId: null,
    visibility: "private",
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
    metadata: null,
    operations,
  } as ResourceSuggestion;
}

/** The first of `items`, which the test expects to be there. */
function first<T>(items: readonly T[]): T {
  for (const item of items) return item;
  throw new Error("Expected at least one item.");
}

describe("useBlocksFieldSuggestions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let latest: Sessions;
  const onSaved = vi.fn();
  /** The suggestions the first save reported. */
  const firstSaved = () =>
    first(first(onSaved.mock.calls)) as ResourceSuggestion[];
  const refetchSuggestions = vi.fn(async () => ({
    data: { suggestions: [] as ResourceSuggestion[] },
    isError: false,
    error: null as Error | null,
  }));
  /** How the tabs' highlights are made; the tests read what it was given. */
  const presentations = vi.fn(
    (_args: { savedSuggestions: ResourceSuggestion[] }) => [] as never[],
  );

  function Harness(props: {
    documentId: string;
    suggesting: boolean;
    saving: boolean;
    saved: ResourceSuggestion[];
  }) {
    // The page's tabs show their text from its read of its properties.
    useQuery({
      queryKey: [
        "action",
        "list-document-properties",
        { documentId: props.documentId },
      ],
      queryFn: async () => null,
      enabled: false,
    });
    latest = useBlocksFieldSuggestions({
      documentId: props.documentId,
      suggesting: props.suggesting,
      saving: props.saving,
      authorEmail: "suggester@example.test",
      saved: props.saved,
      presentations,
      onSaved,
      refetchSuggestions,
      activeSuggestionId: null,
    });
    return null;
  }

  async function render(
    suggesting: boolean,
    saved: ResourceSuggestion[],
    {
      saving = false,
      documentId = "doc-1",
    }: { saving?: boolean; documentId?: string } = {},
  ) {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Harness, { documentId, suggesting, saving, saved }),
        ),
      );
    });
  }

  /** The page's read of its properties, at `revision` of the Notes tab. */
  function showNotes(
    revision: number,
    scope: { documentId: string; databaseId?: string } = {
      documentId: "doc-1",
    },
  ) {
    queryClient.setQueryData(["action", "list-document-properties", scope], {
      documentId: scope.documentId,
      databaseId: scope.databaseId ?? null,
      properties: [{ definition: { id: "notes" }, blocksField: { revision } }],
    });
  }

  /** The saved suggestions the Notes tab highlights over its text. */
  function highlighted() {
    presentations.mockClear();
    latest.provider.visuals("notes", "Original notes.");
    return first(first(presentations.mock.calls)).savedSuggestions.map(
      (suggestion) => suggestion.id,
    );
  }

  async function draftInTab() {
    await act(async () => {
      latest.provider.start("notes", {
        content: "Original notes.",
        revision: 3,
      });
    });
    await act(async () => {
      latest.provider.change("notes", "Original notes, revised.");
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient();
    for (const mock of Object.values(mocks)) mock.mockReset();
    onSaved.mockReset();
    refetchSuggestions.mockClear();
    presentations.mockClear();
    mocks.createProposal.mockImplementation(
      async (request: {
        baseRevision: string;
        suggestions: Array<{ operations: SuggestionOperation[] }>;
      }) => ({
        proposal: { id: "proposal-1" },
        suggestions: request.suggestions.map((entry, index) =>
          savedSuggestion(
            `saved-${index}`,
            entry.operations,
            request.baseRevision,
          ),
        ),
      }),
    );
    // A decision answers with the suggestion as decided.
    mocks.decideSuggestion.mockImplementation(
      async (input: { id: string; decision: string }) => ({
        suggestion: {
          ...savedSuggestion(input.id, [], "blocks-field:notes:3"),
          status: input.decision,
        },
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("saves a tab's draft as a suggestion on that field, made at the revision it started from (CMT-2)", async () => {
    await render(true, []);
    await draftInTab();
    expect(latest.drafts).toHaveLength(1);
    expect(first(first(latest.drafts).operations).targetId).toBe("notes");
    expect(latest.hasOpen).toBe(true);

    let saved = false;
    await act(async () => {
      saved = await latest.flushAll();
    });

    expect(saved).toBe(true);
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "document",
        resourceId: "doc-1",
        adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
        baseRevision: "blocks-field:notes:3",
        suggestions: [
          expect.objectContaining({
            operations: [expect.objectContaining({ targetId: "notes" })],
          }),
        ],
      }),
    );
    const created = firstSaved();
    expect(created.map((suggestion) => suggestion.id)).toEqual(["saved-0"]);

    // Once the list has it, the draft is that suggestion, not a new one.
    await render(true, created);
    expect(latest.drafts).toHaveLength(0);
    expect(latest.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "saved-0",
    ]);
  });

  it("leaves the body's suggestions to the page editor", async () => {
    const body = {
      ...savedSuggestion("body-1", [], "body-revision"),
      adapterKind: "content.document-markdown",
    };
    await render(false, [body]);
    expect(latest.suggestions).toEqual([]);
    expect(latest.hasOpen).toBe(false);
  });

  it("decides a tab's suggestion after saving its draft, then reads the tab again and starts its draft over", async () => {
    const refetchQueries = vi.spyOn(queryClient, "refetchQueries");
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(true, [created]);
    expect(latest.provider.sessions.has("notes")).toBe(true);

    await act(async () => {
      await latest.decide(created, "accepted");
    });

    expect(mocks.decideSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "saved-0",
        decision: "accepted",
        observedBase: "blocks-field:notes:3",
        observedRevision: 1,
      }),
    );
    expect(refetchQueries).toHaveBeenCalledWith(
      {
        queryKey: [
          "action",
          "list-document-properties",
          { documentId: "doc-1" },
        ],
      },
      { throwOnError: true },
    );
    expect(latest.provider.sessions.has("notes")).toBe(false);
    expect(latest.deciding).toBe(false);
    // No thread asked for it, so no quote moved.
    expect(refetchQueries).not.toHaveBeenCalledWith(
      { queryKey: ["action", "list-comments", { documentId: "doc-1" }] },
      { throwOnError: true },
    );
  });

  it("reads the comments with the tab's text when accepting moves the asking thread's quote", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    // Ask AI's suggestion on a tab names its request and thread.
    const asked = {
      ...first(firstSaved()),
      metadata: { sourceThreadId: "thread-1", commentAiRequestId: "request-1" },
    };
    mocks.decideSuggestion.mockResolvedValue({
      suggestion: { ...asked, status: "accepted" },
    });
    await render(true, [asked]);
    // Reads asked for in one synchronous run share a batch and land
    // together, so the tab's new text never shows with the thread's old quote.
    const asks: string[] = [];
    let askedTogether: string[] = [];
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(
      async (filters) => {
        if (asks.length === 0)
          queueMicrotask(() => {
            askedTogether = [...asks];
          });
        asks.push(String(filters?.queryKey?.[1]));
        await landed;
      },
    );

    let decision = Promise.resolve();
    await act(async () => {
      decision = latest.decide(asked, "accepted");
    });
    await vi.waitFor(() => expect(askedTogether.length).toBeGreaterThan(0));
    expect(askedTogether).toEqual([
      "list-document-properties",
      "list-comments",
    ]);

    await act(async () => {
      land();
      await decision;
    });
    expect(latest.deciding).toBe(false);
  });

  it("keeps a decided tab's draft until the tab's text is read afresh", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await latest.flushAll();
      });
      const created = first(firstSaved());
      await render(true, [created]);
      const refetchQueries = vi
        .spyOn(queryClient, "refetchQueries")
        .mockRejectedValueOnce(new Error("Network down"));

      let decision = Promise.resolve();
      await act(async () => {
        decision = latest.decide(created, "accepted");
        await vi.advanceTimersByTimeAsync(0);
      });

      // Restarted on the cached text, the tab would miss the accepted edit.
      expect(mocks.decideSuggestion).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(latest.provider.sessions.has("notes")).toBe(true);
      expect(latest.deciding).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await decision;
      });
      expect(refetchQueries).toHaveBeenCalledTimes(2);
      expect(latest.provider.sessions.has("notes")).toBe(false);
      expect(latest.deciding).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops rereading a decided tab once Suggesting mode ends", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await latest.flushAll();
      });
      const created = first(firstSaved());
      await render(true, [created]);
      const refetchQueries = vi
        .spyOn(queryClient, "refetchQueries")
        .mockRejectedValue(new Error("Network down"));

      let decision = Promise.resolve();
      await act(async () => {
        decision = latest.decide(created, "accepted");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(latest.deciding).toBe(true);

      await render(false, [created]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await decision;
      });
      expect(refetchQueries).toHaveBeenCalledTimes(1);
      expect(latest.deciding).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(refetchQueries).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Suggesting mode when a tab's draft can't be saved", async () => {
    mocks.createProposal.mockRejectedValue(
      Object.assign(new Error("The tab changed"), {
        status: 409,
        errorCode: "suggestion_conflict",
      }),
    );
    await render(true, []);
    await draftInTab();

    let saved = true;
    await act(async () => {
      saved = await latest.flushAll();
    });

    expect(saved).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "editor.suggestionCreateFailed",
      { description: "The tab changed" },
    );
    expect(latest.drafts).toHaveLength(1);
  });

  it("lets a tab's refused draft be discarded, so the page can leave Suggesting mode", async () => {
    mocks.createProposal.mockRejectedValue(
      Object.assign(new Error("The tab changed"), {
        status: 409,
        errorCode: "suggestion_conflict",
      }),
    );
    const refetchQueries = vi.spyOn(queryClient, "refetchQueries");
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    expect(latest.refusedDrafts).toEqual([
      { fieldId: "notes", draft: "Original notes, revised." },
    ]);

    await act(async () => {
      await latest.discard("notes");
    });

    // The tab reads its text afresh, then starts a new draft on it.
    expect(refetchQueries).toHaveBeenCalledWith(
      {
        queryKey: [
          "action",
          "list-document-properties",
          { documentId: "doc-1" },
        ],
      },
      { throwOnError: true },
    );
    expect(latest.provider.sessions.has("notes")).toBe(false);
    expect(latest.refusedDrafts).toEqual([]);
    let saved = false;
    await act(async () => {
      saved = await latest.flushAll();
    });
    expect(saved).toBe(true);
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);
  });

  it("keeps a tab's refused draft when its text can't be read afresh", async () => {
    mocks.createProposal.mockRejectedValue(
      Object.assign(new Error("The tab changed"), {
        status: 409,
        errorCode: "suggestion_conflict",
      }),
    );
    const refetchQueries = vi
      .spyOn(queryClient, "refetchQueries")
      .mockRejectedValueOnce(new Error("Network down"));
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });

    await act(async () => {
      await latest.discard("notes");
    });

    // Restarted on the cached text, the draft would only be refused again.
    expect(mocks.toastError).toHaveBeenCalled();
    expect(latest.provider.sessions.has("notes")).toBe(true);
    expect(latest.refusedDrafts).toEqual([
      { fieldId: "notes", draft: "Original notes, revised." },
    ]);

    await act(async () => {
      await latest.discard("notes");
    });
    expect(refetchQueries).toHaveBeenCalledTimes(2);
    expect(latest.provider.sessions.has("notes")).toBe(false);
    expect(latest.refusedDrafts).toEqual([]);
  });

  it("saves what a tab hadn't when the page leaves Suggesting mode", async () => {
    await render(true, []);
    await draftInTab();
    expect(mocks.createProposal).not.toHaveBeenCalled();

    await render(false, []);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.createProposal).toHaveBeenCalledTimes(1);
    expect(latest.provider.sessions.size).toBe(0);
  });

  it("keeps trying to save a tab's draft after Suggesting mode ends", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValueOnce(new Error("Network down"));
      await render(true, []);
      await draftInTab();

      await render(false, []);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(latest.provider.sessions.size).toBe(0);

      // The retry saves the ended draft rather than skipping it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      expect(mocks.createProposal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resourceId: "doc-1",
          baseRevision: "blocks-field:notes:3",
        }),
      );
      expect(firstSaved().map((suggestion) => suggestion.id)).toEqual([
        "saved-0",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes back a tab's ended draft that is still saving when Suggesting mode starts again", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValueOnce(new Error("Network down"));
      await render(true, []);
      await draftInTab();
      await render(false, []);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);

      await render(true, []);
      await act(async () => {
        latest.provider.start("notes", {
          content: "Original notes.",
          revision: 3,
        });
      });
      expect(latest.provider.sessions.get("notes")?.draft).toBe(
        "Original notes, revised.",
      );

      // The retry saves it as the tab's draft, and nothing is suggested twice.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      let saved = false;
      await act(async () => {
        saved = await latest.flushAll();
      });
      expect(saved).toBe(true);
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      expect(latest.provider.sessions.get("notes")?.draft).toBe(
        "Original notes, revised.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trying a tab's save that was under way when Suggesting mode ended", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);

      let failAmendment: (error: Error) => void = () => {};
      mocks.updateSuggestion.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failAmendment = reject;
          }),
      );
      mocks.updateSuggestion.mockImplementation(
        async (request: { id: string; operations: SuggestionOperation[] }) =>
          savedSuggestion(
            request.id,
            request.operations,
            "blocks-field:notes:3",
          ),
      );
      await act(async () => {
        latest.provider.change("notes", "Original notes, revised again.");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mocks.updateSuggestion).toHaveBeenCalledTimes(1);

      await render(false, []);
      expect(latest.provider.sessions.size).toBe(0);
      await act(async () => {
        failAmendment(new Error("Network down"));
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mocks.updateSuggestion).toHaveBeenCalledTimes(2);
      expect(onSaved).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits longer between retries while a tab's saves keep failing", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValue(new Error("Network down"));
      await render(true, []);
      await draftInTab();
      const advance = async (ms: number) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      };

      await advance(1000);
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);
      await advance(1999);
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);

      // Typing doesn't pull the next retry earlier.
      await act(async () => {
        latest.provider.change("notes", "Original notes, revised again.");
      });
      await advance(3999);
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(mocks.createProposal).toHaveBeenCalledTimes(3);
      expect(mocks.createProposal).toHaveBeenLastCalledWith(
        expect.objectContaining({ baseRevision: "blocks-field:notes:3" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps trying a tab's draft after a save the page asked for fails", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValueOnce(new Error("Network down"));
      await render(true, []);
      await draftInTab();

      // The page's save replaces the draft's queued autosave, then fails.
      let saved = true;
      await act(async () => {
        saved = await latest.flushAll();
      });
      expect(saved).toBe(false);
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      expect(onSaved).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a tab as deciding until a decision on its suggestions ends", async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.decideSuggestion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(true, [created]);
    expect(latest.provider.decidingFields.has("notes")).toBe(false);

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(latest.provider.decidingFields.has("notes")).toBe(true);
    expect(latest.deciding).toBe(true);

    await act(async () => {
      finish?.({ suggestion: { ...created, status: "accepted" } });
      await decision;
    });
    expect(latest.provider.decidingFields.size).toBe(0);
    expect(latest.deciding).toBe(false);
  });

  it("shows a tab's suggestions as they were until the decided text is read", async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.decideSuggestion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(false, [created]);
    expect(highlighted()).toEqual(["saved-0"]);

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    // The list reads the suggestion as accepted before the tab's text with
    // its edit arrives; the tab keeps highlighting it over the old text.
    await render(false, [{ ...created, status: "accepted" }]);
    expect(highlighted()).toEqual(["saved-0"]);

    await act(async () => {
      finish?.({ suggestion: { ...created, status: "accepted" } });
      await decision;
    });
    expect(highlighted()).toEqual([]);
  });

  it("keeps showing a decided tab's suggestions until the page shows its new text, when reading it fails outside Suggesting mode", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(false, [created]);
    await act(async () => {
      showNotes(3);
    });
    vi.spyOn(queryClient, "refetchQueries").mockRejectedValueOnce(
      new Error("Network down"),
    );

    await act(async () => {
      await latest.decide(created, "accepted");
    });
    await render(false, [{ ...created, status: "accepted" }]);
    // The decision is over, but the tab's text holding the edit isn't read.
    expect(latest.deciding).toBe(false);
    expect(highlighted()).toEqual(["saved-0"]);

    // Reads that don't show the new text let nothing go: the page's own,
    // still at the old revision, and another Collection's, not on screen.
    await act(async () => {
      showNotes(3);
      showNotes(4, { documentId: "doc-1", databaseId: "other-collection" });
    });
    expect(highlighted()).toEqual(["saved-0"]);

    // The page shows it when it next reads it.
    await act(async () => {
      showNotes(4);
    });
    expect(highlighted()).toEqual([]);
  });

  it("keeps an earlier decision's suggestion shown when the tab decides again before the page shows its new text", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const accepted = first(firstSaved());
    const rejected = {
      ...accepted,
      id: "saved-1",
      threadId: "suggestion-saved-1",
    };
    await render(false, [accepted, rejected]);
    await act(async () => {
      showNotes(3);
    });
    const refetchQueries = vi
      .spyOn(queryClient, "refetchQueries")
      .mockRejectedValue(new Error("Network down"));

    await act(async () => {
      await latest.decide(accepted, "accepted");
    });
    await render(false, [{ ...accepted, status: "accepted" }, rejected]);
    expect(highlighted()).toEqual(["saved-0", "saved-1"]);

    // Rejecting the other changes no text; the tab still shows the accepted
    // one until its edit is on screen.
    await act(async () => {
      await latest.decide(rejected, "rejected");
    });
    await render(false, [
      { ...accepted, status: "accepted" },
      { ...rejected, status: "rejected" },
    ]);
    expect(highlighted()).toContain("saved-0");

    refetchQueries.mockRestore();
    await act(async () => {
      showNotes(4);
    });
    expect(highlighted()).toEqual([]);
  });

  it("lets a decided tab's suggestions go at once when the page already shows its new text", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(false, [created]);
    await act(async () => {
      showNotes(3);
    });
    vi.spyOn(queryClient, "refetchQueries").mockRejectedValueOnce(
      new Error("Network down"),
    );
    // The page's own read lands while the decision is under way.
    mocks.decideSuggestion.mockImplementation(async () => {
      showNotes(4);
      return { suggestion: { ...created, status: "accepted" } };
    });

    await act(async () => {
      await latest.decide(created, "accepted");
    });
    await render(false, [{ ...created, status: "accepted" }]);
    expect(highlighted()).toEqual([]);
  });

  it("waits on nothing for a page left while its decision was under way", async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.decideSuggestion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(false, [created]);
    await act(async () => {
      showNotes(3);
    });
    // Something else on screen still shows the first page's properties.
    const elsewhere = new QueryObserver(queryClient, {
      queryKey: ["action", "list-document-properties", { documentId: "doc-1" }],
      enabled: false,
    });
    const stopElsewhere = elsewhere.subscribe(() => {});
    vi.spyOn(queryClient, "refetchQueries").mockRejectedValue(
      new Error("Network down"),
    );

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await render(false, [], { documentId: "doc-2" });
    await act(async () => {
      finish?.({ suggestion: { ...created, status: "accepted" } });
      await decision;
    });

    expect(queryClient.getQueryCache().hasListeners()).toBe(false);
    stopElsewhere();
  });

  it("restarts a tab on its new text even when the moved quote can't be read", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const asked = {
      ...first(firstSaved()),
      metadata: { sourceThreadId: "thread-1", commentAiRequestId: "request-1" },
    };
    mocks.decideSuggestion.mockResolvedValue({
      suggestion: { ...asked, status: "accepted" },
    });
    await render(true, [asked]);
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(
      async (filters) => {
        if (filters?.queryKey?.[1] === "list-comments")
          throw new Error("Network down");
      },
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await latest.decide(asked, "accepted");
    });

    expect(latest.deciding).toBe(false);
    expect(latest.provider.sessions.has("notes")).toBe(false);
    expect(mocks.toastError).not.toHaveBeenCalled();
    // The comments are asked for once more.
    await vi.waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["action", "list-comments", { documentId: "doc-1" }],
      }),
    );
  });

  it("saves a tab's draft within five seconds of typing without a pause", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await act(async () => {
        latest.provider.start("notes", {
          content: "Original notes.",
          revision: 3,
        });
      });
      const type = async (markdown: string) => {
        await act(async () => {
          latest.provider.change("notes", markdown);
          await vi.advanceTimersByTimeAsync(500);
        });
      };
      for (let count = 1; count <= 9; count += 1)
        await type(`Original notes${"!".repeat(count)}`);
      // Four and a half seconds of typing, never a second's pause.
      expect(mocks.createProposal).not.toHaveBeenCalled();

      await type("Original notes, still typing.");
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the tabs from typing while the page saves to leave Suggesting mode", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const creation = mocks.createProposal.getMockImplementation();
    mocks.createProposal.mockImplementationOnce(
      (request: Parameters<NonNullable<typeof creation>>[0]) =>
        new Promise((resolve) => {
          finish = () => resolve(creation?.(request));
        }),
    );
    await render(true, []);
    await draftInTab();
    expect(latest.provider.leaving).toBe(false);

    // The tabs' own saves first, then the page body's.
    let flushed: Promise<boolean> | undefined;
    await act(async () => {
      flushed = latest.flushAll();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(latest.provider.leaving).toBe(true);
    await act(async () => {
      finish?.(undefined);
      await flushed;
    });
    expect(latest.provider.leaving).toBe(false);

    await render(true, [], { saving: true });
    expect(latest.provider.leaving).toBe(true);
    await render(true, []);
    expect(latest.provider.leaving).toBe(false);
  });

  it("asks before the browser leaves while a tab's draft isn't saved", async () => {
    await render(true, []);
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await draftInTab();

    let asked = false;
    await act(async () => {
      asked = leave();
      await Promise.resolve();
    });
    expect(asked).toBe(true);
    // It saves the draft at once rather than waiting for its autosave.
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest.flushAll();
    });
    expect(leave()).toBe(false);
  });

  it("still asks before the browser leaves while an ended tab's draft retries", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValueOnce(new Error("Network down"));
      await render(true, []);
      const leave = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      await draftInTab();

      await render(false, []);
      await act(async () => {
        await Promise.resolve();
      });
      expect(latest.provider.sessions.size).toBe(0);

      let asked = false;
      await act(async () => {
        asked = leave();
        await Promise.resolve();
      });
      expect(asked).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
      expect(leave()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops asking once an ended tab's draft is refused", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValueOnce(
        Object.assign(new Error("Refused"), { status: 409 }),
      );
      await render(true, []);
      const leave = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      await draftInTab();

      await render(false, []);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.createProposal).toHaveBeenCalledTimes(1);
      expect(leave()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't take a failed read of the suggestions for a fresh one", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    // Someone decided the suggestion while the author kept typing on it.
    mocks.updateSuggestion.mockRejectedValue(
      Object.assign(new Error("The suggestion changed"), {
        status: 409,
        errorCode: "suggestion_conflict",
      }),
    );
    // The read fails, but resolves with the list it read before.
    refetchSuggestions.mockResolvedValueOnce({
      data: { suggestions: [created] },
      isError: true,
      error: new Error("Network down"),
    });
    await act(async () => {
      latest.provider.change("notes", "Original notes, revised again.");
    });

    let saved = true;
    await act(async () => {
      saved = await latest.flushAll();
    });
    expect(saved).toBe(false);
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);

    // Read for real, the decided suggestion's edit is suggested anew.
    refetchSuggestions.mockResolvedValueOnce({
      data: { suggestions: [{ ...created, status: "rejected" }] },
      isError: false,
      error: null,
    });
    await act(async () => {
      saved = await latest.flushAll();
    });
    expect(saved).toBe(true);
    expect(mocks.createProposal).toHaveBeenCalledTimes(2);
  });

  it("decides on the newest revision of a tab suggestion someone else amended", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    // The tab's own copy is revision 1; the list has someone's amendment.
    const amended = { ...created, revision: 2 };
    await render(true, [amended]);

    await act(async () => {
      await latest.decide(created, "accepted");
    });

    expect(mocks.decideSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved-0", observedRevision: 2 }),
    );
  });
});
