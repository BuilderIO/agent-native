// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperationsForFindReplaceEdits } from "@shared/suggestion-diff";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const review = vi.hoisted(() => ({
  suggestions: [] as ResourceSuggestion[],
  refetch: vi.fn(),
  decide: vi.fn(),
  decideProposal: vi.fn(),
}));
const page = vi.hoisted(() => ({ canEdit: true }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    (error as { message?: string } | null)?.message,
}));
vi.mock("@agent-native/core/client/review", () => ({
  useResourceSuggestions: () => ({
    data: { suggestions: review.suggestions },
    isPending: false,
    isError: false,
    refetch: review.refetch,
  }),
  useDecideResourceSuggestion: () => ({
    mutateAsync: review.decide,
    isPending: false,
  }),
  useDecideResourceSuggestionProposal: () => ({
    mutateAsync: review.decideProposal,
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({
    data: { title: "Launch notes", icon: null, canEdit: page.canEdit },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/components/icons/ContentIcon", () => ({ ContentIcon: () => null }));

import { SuggestionReviewCard } from "./SuggestionReviewCard";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const before = "Open source is open.\n\nFork Open source today.\n";
const operations = markdownSuggestionOperationsForFindReplaceEdits({
  before,
  edits: [
    { find: "Open source is", replace: "Open-source is", start: 0 },
    {
      find: "Open source today",
      replace: "Open-source today",
      start: before.indexOf("Open source today"),
    },
  ],
});

function suggestion(
  id: string,
  proposalId: string | null,
  operation: (typeof operations)[number],
  status: ResourceSuggestion["status"] = "pending",
): ResourceSuggestion {
  return {
    id,
    proposalId,
    proposalSummary: proposalId ? "Hyphenate Open-source" : null,
    summary: `Edit ${id}`,
    status,
    revision: 3,
    baseRevision: "base-1",
    createdAt: "2026-10-21T17:00:00.000Z",
    metadata: {},
    operations: [{ ...operation, ordinal: 0 }],
  } as unknown as ResourceSuggestion;
}

const proposal = () => [
  suggestion("edit-0", "proposal-1", operations[0]!),
  suggestion("edit-1", "proposal-1", operations[1]!),
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  review.suggestions = [
    ...proposal(),
    suggestion("other", null, operations[0]!),
  ];
  review.refetch.mockReset();
  review.refetch.mockImplementation(async () => ({
    data: { suggestions: review.suggestions },
  }));
  review.decide.mockReset();
  review.decideProposal.mockReset();
  page.canEdit = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(suggestionIds: string[] = ["edit-0", "edit-1"]) {
  act(() =>
    root.render(
      <SuggestionReviewCard documentId="doc-1" suggestionIds={suggestionIds} />,
    ),
  );
}

const button = (label: string, index = 0) =>
  [...host.querySelectorAll("button")].filter(
    (entry) => entry.textContent === label,
  )[index];

const shownEdits = () =>
  [...host.querySelectorAll("[data-thread-suggestion]")].map((edit) =>
    edit.getAttribute("data-thread-suggestion"),
  );

describe("SuggestionReviewCard", () => {
  it("shows every edit of the call's proposal and accepts them together", async () => {
    render(["edit-0"]);

    expect(host.querySelector("h1")?.textContent).toBe("Launch notes");
    expect(shownEdits()).toEqual(["edit-0", "edit-1"]);
    await act(async () => button("comments.acceptAll")!.click());

    expect(review.decideProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "proposal-1",
        decision: "accepted",
        members: [
          { id: "edit-0", observedRevision: 3, observedBase: "base-1" },
          { id: "edit-1", observedRevision: 3, observedBase: "base-1" },
        ],
      }),
    );
  });

  it("decides one edit against the revision the card showed", async () => {
    render();

    await act(async () => button("editor.rejectSuggestion", 1)!.click());

    expect(review.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "edit-1",
        decision: "rejected",
        observedBase: "base-1",
        observedRevision: 3,
      }),
    );
    expect(review.refetch).toHaveBeenCalled();
  });

  it("keeps an edit whose text changed pending and says why", async () => {
    review.decide.mockRejectedValue({ errorCode: "suggestion_stale" });
    render();

    await act(async () => button("editor.acceptSuggestion")!.click());

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "editor.toolbar.conflict",
    );
    expect(
      [...host.querySelectorAll('[role="alert"]')].map(
        (alert) => alert.textContent,
      ),
    ).toContain("editor.suggestionUnplaceable");
    expect(button("editor.acceptSuggestion")!.disabled).toBe(true);
    expect(button("editor.rejectSuggestion")!.disabled).toBe(false);
  });

  it("drops the conflict once the changed edit is rejected", async () => {
    review.decide.mockRejectedValueOnce({ errorCode: "suggestion_stale" });
    render();
    await act(async () => button("editor.acceptSuggestion")!.click());

    review.decide.mockResolvedValueOnce({});
    review.refetch.mockImplementation(async () => {
      review.suggestions = [
        suggestion("edit-0", "proposal-1", operations[0]!, "rejected"),
        suggestion("edit-1", "proposal-1", operations[1]!),
      ];
      return { data: { suggestions: review.suggestions } };
    });
    await act(async () => button("editor.rejectSuggestion")!.click());
    render();

    expect(host.textContent).not.toContain("editor.toolbar.conflict");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "comments.rejected",
    );
  });

  it("shows how an edit ended when someone decided it elsewhere first", async () => {
    review.decide.mockRejectedValue({
      errorCode: "suggestion_conflict",
      message: "Already decided",
    });
    review.refetch.mockImplementation(async () => {
      review.suggestions = [
        suggestion("edit-0", "proposal-1", operations[0]!, "accepted"),
        suggestion("edit-1", "proposal-1", operations[1]!, "accepted"),
      ];
      return { data: { suggestions: review.suggestions } };
    });
    render();

    await act(async () => button("editor.acceptSuggestion")!.click());
    render();

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "comments.accepted",
    );
    expect(host.querySelector("button")).toBeNull();
  });

  it("reports a failed decision that left the edit pending", async () => {
    review.decide.mockRejectedValue({
      errorCode: "suggestion_conflict",
      message: "The page is busy. Try again.",
    });
    render();

    await act(async () => button("editor.acceptSuggestion")!.click());

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "The page is busy. Try again.",
    );
  });

  it("tells a reader who cannot edit the page why there is nothing to decide", () => {
    page.canEdit = false;
    render();

    expect(shownEdits()).toEqual(["edit-0", "edit-1"]);
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("comments.suggestionReviewReadOnly");
  });

  it("says the suggestion is unavailable when the call's edits are gone", () => {
    render(["missing"]);

    expect(host.textContent).toBe("comments.linkUnavailable");
  });
});
