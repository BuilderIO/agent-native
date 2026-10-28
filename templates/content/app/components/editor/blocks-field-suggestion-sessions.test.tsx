// @vitest-environment happy-dom

import type {
  ResourceSuggestion,
  SuggestionOperation,
} from "@agent-native/core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

describe("useBlocksFieldSuggestions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let latest: Sessions;
  const onSaved = vi.fn();
  const refetchSuggestions = vi.fn(async () => [] as ResourceSuggestion[]);

  function Harness(props: {
    suggesting: boolean;
    saved: ResourceSuggestion[];
  }) {
    latest = useBlocksFieldSuggestions({
      documentId: "doc-1",
      suggesting: props.suggesting,
      authorEmail: "suggester@example.test",
      saved: props.saved,
      presentations: () => [],
      onSaved,
      refetchSuggestions,
      activeSuggestionId: null,
    });
    return null;
  }

  async function render(suggesting: boolean, saved: ResourceSuggestion[]) {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Harness, { suggesting, saved }),
        ),
      );
    });
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
    expect(latest.drafts[0]!.operations[0]!.targetId).toBe("notes");
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
    const created = onSaved.mock.calls[0]![0] as ResourceSuggestion[];
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
    mocks.decideSuggestion.mockResolvedValue({});
    await render(true, []);
    await draftInTab();
    await act(async () => {
      await latest.flushAll();
    });
    const [created] = onSaved.mock.calls[0]![0] as ResourceSuggestion[];
    await render(true, [created!]);
    expect(latest.provider.sessions.has("notes")).toBe(true);

    await act(async () => {
      await latest.decide(created!, "accepted");
    });

    expect(mocks.decideSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "saved-0",
        decision: "accepted",
        observedBase: "blocks-field:notes:3",
        observedRevision: 1,
      }),
    );
    expect(refetchQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-document-properties", { documentId: "doc-1" }],
    });
    expect(latest.provider.sessions.has("notes")).toBe(false);
    expect(latest.deciding).toBe(false);
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
});
