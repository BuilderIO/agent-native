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

  /**
   * The page's read of its properties, at `revision` of the Notes tab, with
   * the tab's text when given.
   */
  function showNotes(
    revision: number,
    scope: { documentId: string; databaseId?: string } = {
      documentId: "doc-1",
    },
    value?: string,
  ) {
    queryClient.setQueryData(["action", "list-document-properties", scope], {
      documentId: scope.documentId,
      databaseId: scope.databaseId ?? null,
      properties: [
        {
          definition: { id: "notes" },
          blocksField: { revision },
          ...(value === undefined ? {} : { value }),
        },
      ],
    });
  }

  /** What the Notes tab highlights while it shows `markdown`. */
  function highlightedOver(markdown: string) {
    presentations.mockClear();
    latest.provider.visuals("notes", markdown);
    return first(first(presentations.mock.calls)).savedSuggestions.map(
      (suggestion) => suggestion.id,
    );
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

  it("shows a tab's accepted suggestion in its text at once, before the server answers", async () => {
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
    await act(async () => {
      showNotes(3, undefined, "Original notes.");
    });

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
    });
    // The tab shows the edit as text, as the server writes it, and no longer
    // highlights it, while the decision is still on its way.
    expect(finish).toBeDefined();
    expect(latest.provider.previews.get("notes")?.text).toBe(
      "Original notes, revised.",
    );
    expect(highlightedOver("Original notes, revised.")).toEqual([]);

    // Reading the tab's text again brings what the server wrote.
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(async () => {
      showNotes(4, undefined, "Original notes, revised.");
    });
    await act(async () => {
      finish?.({ suggestion: { ...created, status: "accepted" } });
      await decision;
    });
    // The page has read the tab's new text. The tab keeps the preview's
    // words until its own copy holds that revision.
    expect(latest.provider.previews.size).toBe(0);
    expect(latest.provider.landed.get("notes")).toEqual({
      key: expect.any(String),
      text: "Original notes, revised.",
      revision: 4,
    });
  });

  it("puts a tab's text back when accepting its suggestion fails", async () => {
    let fail: ((error: Error) => void) | undefined;
    mocks.decideSuggestion.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(true, [created]);
    await act(async () => {
      showNotes(3, undefined, "Original notes.");
    });

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
    });
    expect(latest.provider.previews.has("notes")).toBe(true);

    await act(async () => {
      fail?.(new Error("Network down"));
      await decision;
    });
    expect(latest.provider.previews.size).toBe(0);
    expect(latest.provider.landed.size).toBe(0);
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("puts a tab's text back as soon as the server doesn't accept its suggestion", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    // Someone rejected it first.
    mocks.decideSuggestion.mockResolvedValue({
      suggestion: { ...created, status: "rejected" },
    });
    await render(true, [created]);
    await act(async () => {
      showNotes(3, undefined, "Original notes.");
    });
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(async () => {
      await landed;
    });

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(created, "accepted");
    });
    // The tab's text isn't read yet, but nothing it previewed was written.
    await vi.waitFor(() => expect(latest.provider.previews.size).toBe(0));
    expect(latest.provider.landed.size).toBe(0);
    expect(latest.deciding).toBe(true);

    await act(async () => {
      land();
      await decision;
    });
    expect(latest.deciding).toBe(false);
  });

  it("moves the asking thread's quote onto the new words at once, and reads it again when accepting fails", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const asked = {
      ...first(firstSaved()),
      metadata: { sourceThreadId: "thread-1", commentAiRequestId: "request-1" },
    };
    let fail: ((error: Error) => void) | undefined;
    mocks.decideSuggestion.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await render(true, [asked]);
    const commentsKey = ["action", "list-comments", { documentId: "doc-1" }];
    await act(async () => {
      showNotes(3, undefined, "Original notes.");
      queryClient.setQueryData(commentsKey, {
        comments: [
          {
            id: "comment-1",
            document_id: "doc-1",
            thread_id: "thread-1",
            parent_id: null,
            field_id: "notes",
            content: "Make this longer",
            quoted_text: "notes.",
            anchor_prefix: "Original ",
            anchor_suffix: "",
            anchor_start_offset: 9,
          },
        ],
      });
    });
    const quote = () =>
      first(
        (
          queryClient.getQueryData(commentsKey) as {
            comments: Array<{ quoted_text: string | null }>;
          }
        ).comments,
      ).quoted_text;
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    let decision: Promise<void> | undefined;
    await act(async () => {
      decision = latest.decide(asked, "accepted");
    });
    // The thread's highlight moves with the tab's new text, before the
    // comments are read again.
    expect(quote()).toBe("notes, revised.");

    await act(async () => {
      fail?.(new Error("Network down"));
      await decision;
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: commentsKey });
  });

  it("lands the text the server wrote when saving the tab's draft changed the suggestion it previewed", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    await render(true, [created]);
    await act(async () => {
      showNotes(3, undefined, "Original notes.");
      // Typing more amends the saved suggestion when the draft is saved.
      latest.provider.change("notes", "Original notes, revised again.");
    });
    mocks.updateSuggestion.mockImplementation(
      async (request: { operations: unknown }) => ({
        ...created,
        operations: request.operations,
        revision: 2,
      }),
    );
    mocks.decideSuggestion.mockImplementation(async () => ({
      suggestion: { ...created, revision: 2, status: "accepted" },
    }));
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(async () => {
      showNotes(4, undefined, "Original notes, revised again.");
    });

    await act(async () => {
      await latest.decide(created, "accepted");
    });
    expect(mocks.decideSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ observedRevision: 2 }),
    );
    expect(latest.provider.landed.get("notes")).toMatchObject({
      text: "Original notes, revised again.",
      revision: 4,
    });
  });

  it("keeps reading a tab's text after accepting outside Suggesting mode until the read works, showing the new words meanwhile", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await latest.flushAll();
      });
      const created = first(firstSaved());
      await render(false, [created]);
      await act(async () => {
        showNotes(3, undefined, "Original notes.");
      });
      mocks.decideSuggestion.mockResolvedValueOnce({
        suggestion: { ...created, status: "accepted" },
      });
      const refetchQueries = vi
        .spyOn(queryClient, "refetchQueries")
        .mockRejectedValueOnce(new Error("Network down"))
        .mockImplementation(async () => {
          showNotes(4, undefined, "Original notes, revised.");
        });

      let decision = Promise.resolve();
      await act(async () => {
        decision = latest.decide(created, "accepted");
        await vi.advanceTimersByTimeAsync(0);
      });
      // The read failed once. The tab keeps the new words and takes no typing
      // while it tries again. Only its own suggestions wait meanwhile.
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(latest.provider.previews.get("notes")?.text).toBe(
        "Original notes, revised.",
      );
      expect(latest.deciding).toBe(false);
      expect(latest.decidingSuggestion(created.id)).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        await decision;
      });
      expect(refetchQueries).toHaveBeenCalledTimes(2);
      expect(latest.deciding).toBe(false);
      expect(latest.decidingSuggestion(created.id)).toBe(false);
      expect(latest.provider.previews.size).toBe(0);
      expect(latest.provider.landed.get("notes")).toMatchObject({
        text: "Original notes, revised.",
        revision: 4,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("decides on other tabs' suggestions while a tab reads its accepted text again, but not on that tab's", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await latest.flushAll();
      });
      const created = first(firstSaved());
      const sameTab = savedSuggestion(
        "notes-2",
        created.operations,
        created.baseRevision,
      );
      const otherTab = savedSuggestion(
        "summary-1",
        created.operations.map((operation) => ({
          ...operation,
          targetId: "summary",
        })),
        created.baseRevision,
      );
      await render(false, [created, sameTab, otherTab]);
      await act(async () => {
        showNotes(3, undefined, "Original notes.");
      });
      mocks.decideSuggestion.mockImplementation(
        async (request: { id: string; decision: string }) => ({
          suggestion: {
            ...[created, sameTab, otherTab].find(
              (suggestion) => suggestion.id === request.id,
            ),
            status: request.decision,
          },
        }),
      );
      const refetchQueries = vi
        .spyOn(queryClient, "refetchQueries")
        .mockRejectedValue(new Error("Network down"));

      let decision = Promise.resolve();
      await act(async () => {
        decision = latest.decide(created, "accepted");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(latest.provider.previews.get("notes")?.text).toBe(
        "Original notes, revised.",
      );
      expect(latest.decidingSuggestion(sameTab.id)).toBe(true);
      expect(latest.decidingSuggestion(otherTab.id)).toBe(false);

      await act(async () => {
        await latest.decide(otherTab, "rejected");
        await latest.decide(sameTab, "rejected");
      });
      expect(mocks.decideSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: otherTab.id, decision: "rejected" }),
      );
      expect(mocks.decideSuggestion).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: sameTab.id }),
      );
      // The tab still shows what accepting wrote while it tries again.
      expect(latest.provider.previews.get("notes")?.text).toBe(
        "Original notes, revised.",
      );

      refetchQueries.mockImplementation(async () => {
        showNotes(4, undefined, "Original notes, revised.");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        await decision;
      });
      expect(latest.provider.previews.size).toBe(0);
      expect(latest.decidingSuggestion(sameTab.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reading a tab's text it can't read once its page is left", async () => {
    vi.useFakeTimers();
    try {
      await render(true, []);
      await draftInTab();
      await act(async () => {
        await latest.flushAll();
      });
      const created = first(firstSaved());
      await render(false, [created]);
      await act(async () => {
        showNotes(3, undefined, "Original notes.");
      });
      mocks.decideSuggestion.mockResolvedValueOnce({
        suggestion: { ...created, status: "accepted" },
      });
      const refetchQueries = vi
        .spyOn(queryClient, "refetchQueries")
        .mockRejectedValue(new Error("Network down"));

      let decision = Promise.resolve();
      await act(async () => {
        decision = latest.decide(created, "accepted");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(latest.decidingSuggestion(created.id)).toBe(true);
      await render(false, [created], { documentId: "doc-2" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await decision;
      });
      const reads = refetchQueries.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(refetchQueries.mock.calls.length).toBe(reads);
      expect(latest.provider.previews.size).toBe(0);
      expect(latest.provider.landed.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops highlighting a rejected tab suggestion at once", async () => {
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
      decision = latest.decide(created, "rejected");
    });
    expect(finish).toBeDefined();
    expect(highlighted()).toEqual([]);

    await act(async () => {
      finish?.({ suggestion: { ...created, status: "rejected" } });
      await decision;
    });
    await render(false, [{ ...created, status: "rejected" }]);
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

  it("keeps showing a decided tab's suggestions through a read from before the decision, when the page showed none of the tab yet", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const created = first(firstSaved());
    // The page's first read of its properties is still on its way.
    await render(false, [created]);
    vi.spyOn(queryClient, "refetchQueries").mockRejectedValueOnce(
      new Error("Network down"),
    );

    await act(async () => {
      await latest.decide(created, "accepted");
    });
    await render(false, [{ ...created, status: "accepted" }]);
    expect(highlighted()).toEqual(["saved-0"]);

    // That read lands with the text the suggestion was made on, without
    // its edit.
    await act(async () => {
      showNotes(3);
    });
    expect(highlighted()).toEqual(["saved-0"]);

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

    // Rejecting the other changes no text, so the tab stops showing it at
    // once, and still shows the accepted one until its edit is on screen.
    await act(async () => {
      await latest.decide(rejected, "rejected");
    });
    await render(false, [
      { ...accepted, status: "accepted" },
      { ...rejected, status: "rejected" },
    ]);
    expect(highlighted()).toEqual(["saved-0"]);

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

  it("restarts a tab on its new text only once the moved quote is read too", async () => {
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
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    // The tab's text arrives, and the comments come after it.
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(
      async (filters) => {
        if (filters?.queryKey?.[1] === "list-comments") await landed;
      },
    );

    let decision = Promise.resolve();
    await act(async () => {
      decision = latest.decide(asked, "accepted");
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(mocks.decideSuggestion).toHaveBeenCalledTimes(1),
      );
      await Promise.resolve();
    });
    expect(latest.deciding).toBe(true);
    expect(latest.provider.sessions.has("notes")).toBe(true);

    await act(async () => {
      land();
      await decision;
    });
    expect(latest.deciding).toBe(false);
    expect(latest.provider.sessions.has("notes")).toBe(false);
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

  it("keeps showing a decided tab's suggestions until the moved quote is read after the page shows its new text", async () => {
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
    await render(false, [asked]);
    await act(async () => {
      showNotes(3);
    });
    // Outside Suggesting mode, the decision can't read the text or the
    // comments itself, and the comments come some time after they're asked.
    vi.spyOn(queryClient, "refetchQueries").mockRejectedValue(
      new Error("Network down"),
    );
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(() => landed);

    await act(async () => {
      await latest.decide(asked, "accepted");
    });
    await render(false, [{ ...asked, status: "accepted" }]);
    expect(highlighted()).toEqual(["saved-0"]);

    // The page shows the new text, and the comments are asked for again.
    invalidateQueries.mockClear();
    await act(async () => {
      showNotes(4);
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-comments", { documentId: "doc-1" }],
    });
    expect(highlighted()).toEqual(["saved-0"]);

    await act(async () => {
      land();
      await landed;
    });
    expect(highlighted()).toEqual([]);
  });

  it("reads an earlier decision's moved quote with the text when the tab decides again first", async () => {
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const asked = {
      ...first(firstSaved()),
      metadata: { sourceThreadId: "thread-1", commentAiRequestId: "request-1" },
    };
    const rejected = {
      ...asked,
      id: "saved-1",
      threadId: "suggestion-saved-1",
    };
    await render(false, [asked, rejected]);
    await act(async () => {
      showNotes(3);
    });
    mocks.decideSuggestion.mockResolvedValueOnce({
      suggestion: { ...asked, status: "accepted" },
    });
    // Accepting can't read the tab's text, so the tab keeps its view.
    const refetchQueries = vi
      .spyOn(queryClient, "refetchQueries")
      .mockRejectedValueOnce(new Error("Network down"));
    await act(async () => {
      await latest.decide(asked, "accepted");
    });
    await render(false, [{ ...asked, status: "accepted" }, rejected]);

    // Rejecting moves no quote itself, but the text it reads has the
    // accepted edit, so the comments are read with it.
    refetchQueries.mockClear();
    await act(async () => {
      await latest.decide(rejected, "rejected");
    });
    expect(refetchQueries).toHaveBeenCalledWith(
      { queryKey: ["action", "list-comments", { documentId: "doc-1" }] },
      { throwOnError: true },
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

  it("doesn't save a refused tab draft on every keystroke past the max wait", async () => {
    vi.useFakeTimers();
    try {
      mocks.createProposal.mockRejectedValue(
        Object.assign(new Error("The tab changed"), {
          status: 409,
          errorCode: "suggestion_conflict",
        }),
      );
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
          await vi.advanceTimersByTimeAsync(250);
        });
      };
      // Twelve seconds of typing a character every quarter second: the
      // first save after five seconds is refused, and the next waits five
      // seconds more.
      for (let count = 1; count <= 48; count += 1)
        await type(`Original notes${"!".repeat(count)}`);
      expect(mocks.createProposal).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the max wait over for typing during a slow save", async () => {
    vi.useFakeTimers();
    try {
      // Every save takes two seconds.
      const creation = mocks.createProposal.getMockImplementation();
      mocks.createProposal.mockImplementation(
        async (request: Parameters<NonNullable<typeof creation>>[0]) => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return creation?.(request);
        },
      );
      mocks.updateSuggestion.mockImplementation(
        async (request: { id: string; operations: SuggestionOperation[] }) => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return savedSuggestion(
            request.id,
            request.operations,
            "blocks-field:notes:3",
          );
        },
      );
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
          await vi.advanceTimersByTimeAsync(250);
        });
      };
      // Twelve seconds of typing a character every quarter second: the first
      // save starts after five seconds, and the typing it misses waits five
      // seconds more, rather than saving again as soon as it ends.
      for (let count = 1; count <= 48; count += 1)
        await type(`Original notes${"!".repeat(count)}`);
      expect(
        mocks.createProposal.mock.calls.length +
          mocks.updateSuggestion.mock.calls.length,
      ).toBe(2);
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
