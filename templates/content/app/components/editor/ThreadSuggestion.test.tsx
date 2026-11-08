// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperationsForFindReplaceEdits } from "@shared/suggestion-diff";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ThreadSuggestionBody } from "./ThreadSuggestion";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

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
const proposal = (status: ResourceSuggestion["status"] = "pending") =>
  operations.map(
    (operation, index) =>
      ({
        id: `edit-${index}`,
        proposalId: "proposal-1",
        proposalSummary: "Hyphenate Open-source",
        summary: `Edit ${index}`,
        status,
        createdAt: "2026-10-19T17:00:00.000Z",
        metadata: { sourceThreadId: "t1", commentAiRequestId: "request-1" },
        operations: [{ ...operation, ordinal: 0 }],
      }) as unknown as ResourceSuggestion,
  );

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(
  suggestions: ResourceSuggestion[],
  handlers: {
    onDecide?: (...args: unknown[]) => void;
    onDecideUnit?: (...args: unknown[]) => void;
    onDecideRemaining?: (...args: unknown[]) => void;
    conflict?: (suggestion: ResourceSuggestion) => boolean;
  } = {},
) {
  act(() =>
    root.render(
      <TooltipProvider>
        <ThreadSuggestionBody
          suggestions={suggestions}
          canDecide
          busy={() => false}
          conflict={handlers.conflict ?? (() => false)}
          onDecide={handlers.onDecide ?? (() => {})}
          onDecideUnit={handlers.onDecideUnit ?? (() => {})}
          {...(handlers.onDecideRemaining
            ? { onDecideRemaining: handlers.onDecideRemaining }
            : {})}
        />
      </TooltipProvider>,
    ),
  );
}

// Accept and Reject are icons named by their aria-label.
const button = (label: string, index = 0) =>
  [...host.querySelectorAll("button")].filter(
    (entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label,
  )[index]!;

const openGroup = () => {
  const toggle = host.querySelector<HTMLButtonElement>(
    "[data-suggestion-proposal] > button[aria-expanded]",
  );
  if (!toggle) throw new Error("No suggestion group to open");
  act(() => toggle.click());
};

describe("ThreadSuggestionBody", () => {
  it("shows a proposal's summary once and each edit as its own small change", () => {
    const suggestions = proposal();
    const onDecide = vi.fn();
    const onDecideRemaining = vi.fn();
    render(suggestions, { onDecide, onDecideRemaining });

    expect(host.textContent?.match(/Hyphenate Open-source/g)).toHaveLength(1);
    openGroup();
    const diffs = [...host.querySelectorAll("[data-thread-suggestion-diff]")];
    expect(diffs.map((diff) => diff.querySelector("del")?.textContent)).toEqual(
      ["Open source ", "Open source "],
    );
    expect(diffs.map((diff) => diff.querySelector("ins")?.textContent)).toEqual(
      ["Open-source ", "Open-source "],
    );
    expect(diffs[0]!.textContent).not.toContain("Fork");

    act(() => button("editor.acceptSuggestion", 1).click());
    expect(onDecide).toHaveBeenCalledWith(suggestions[1], "accepted");
    act(() => button("comments.acceptAll").click());
    expect(onDecideRemaining).toHaveBeenCalledWith("accepted");
  });

  it("closes a proposal to its summary and group decision until opened", () => {
    render(proposal(), { onDecideRemaining: vi.fn() });

    expect(
      host.querySelector("[data-suggestion-proposal] > button")?.textContent,
    ).toContain("Hyphenate Open-source");
    expect(host.querySelector("[data-thread-suggestion]")).toBeNull();
    expect(button("comments.acceptAll")).toBeDefined();
    expect(button("comments.rejectAll")).toBeDefined();

    openGroup();
    expect(host.querySelectorAll("[data-thread-suggestion]")).toHaveLength(2);
  });

  it("decides the rest of a proposal once one edit is decided", () => {
    const [first, second, third] = [...proposal(), ...proposal()].map(
      (suggestion, index) => ({ ...suggestion, id: `edit-${index}` }),
    );
    const onDecideRemaining = vi.fn();
    render([{ ...first!, status: "accepted" }, second!, third!], {
      onDecideRemaining,
    });

    expect(button("comments.acceptAll")).toBeUndefined();
    act(() => button("comments.rejectRemaining").click());
    expect(onDecideRemaining).toHaveBeenCalledWith("rejected");
  });

  it("says a shared outcome once instead of under every edit", () => {
    render(proposal("superseded"));

    expect(
      [...host.querySelectorAll('[role="status"]')].map(
        (status) => status.textContent,
      ),
    ).toEqual(["comments.suggestionReplaced"]);
    openGroup();
    expect(host.querySelector("[data-suggestion-decision]")).toBeNull();
    expect(
      host.querySelector("[data-suggestion-proposal-decision]"),
    ).toBeNull();
  });

  it("keeps a group accept from failing on an edit that cannot be placed", () => {
    const suggestions = proposal();
    render(suggestions, {
      onDecideRemaining: vi.fn(),
      conflict: (suggestion) => suggestion.id === suggestions[1]!.id,
    });

    expect(button("comments.acceptAll").disabled).toBe(true);
    expect(button("comments.rejectAll").disabled).toBe(false);
  });

  it("only rejects what's left of a unit with a stale piece", () => {
    const [first = null, second = null] = proposal();
    if (!first || !second) throw new Error("The proposal has two edits");
    const onDecideUnit = vi.fn();
    const stale = {
      ...first,
      status: "stale",
      metadata: { reviewUnit: "key:0" },
    } as ResourceSuggestion;
    const open = { ...second, metadata: { reviewUnit: "key:0" } };
    render([stale, open], { onDecideUnit });

    expect(button("editor.acceptSuggestion").disabled).toBe(true);
    act(() => button("editor.rejectSuggestion").click());

    expect(onDecideUnit).toHaveBeenCalledWith([open], "rejected");
  });

  it("keeps a group accept from taking what's left of a stale unit", () => {
    const [first = null, second = null] = proposal();
    if (!first || !second) throw new Error("The proposal has two edits");
    render(
      [
        {
          ...first,
          status: "stale",
          metadata: { reviewUnit: "key:0" },
        } as ResourceSuggestion,
        { ...second, metadata: { reviewUnit: "key:0" } },
        { ...second, id: "edit-2", metadata: { reviewUnit: "key:1" } },
      ],
      { onDecideRemaining: vi.fn() },
    );

    expect(button("comments.acceptRemaining").disabled).toBe(true);
    expect(button("comments.rejectRemaining").disabled).toBe(false);
  });

  it("gives a unit's pieces one Accept that decides them together", () => {
    const pieces = proposal().map((suggestion) => ({
      ...suggestion,
      metadata: { ...suggestion.metadata, reviewUnit: "key:0" },
    }));
    const onDecide = vi.fn();
    const onDecideUnit = vi.fn();
    render(pieces, { onDecide, onDecideUnit });

    expect(host.querySelector("[data-suggestion-proposal]")).toBeNull();
    expect(host.querySelectorAll("[data-thread-suggestion]")).toHaveLength(1);
    const diff = host.querySelector("[data-thread-suggestion-diff]");
    expect(diff?.querySelector("del")?.textContent).toBeTruthy();

    act(() => button("editor.acceptSuggestion").click());
    expect(onDecideUnit).toHaveBeenCalledWith(pieces, "accepted");
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("shows every change of a unit it can't read as one", () => {
    const source = "Remove this.\nTeh team will recieve.\n";
    const pieces = markdownSuggestionOperationsForFindReplaceEdits({
      before: source,
      edits: [
        {
          find: source,
          replace: "<empty-block/>\nThe team will receive.\n",
          start: 0,
        },
      ],
    }).map(
      (operation, index) =>
        ({
          id: `piece-${index}`,
          proposalId: "proposal-1",
          proposalSummary: "Tidy the note",
          summary: `Piece ${index}`,
          status: "pending",
          createdAt: "2026-10-19T17:00:00.000Z",
          metadata: { reviewUnit: "key:0" },
          operations: [{ ...operation, ordinal: 0 }],
        }) as unknown as ResourceSuggestion,
    );
    expect(pieces.length).toBeGreaterThan(1);
    const onDecideUnit = vi.fn();
    render(pieces, { onDecideUnit });

    expect(host.querySelectorAll("[data-thread-suggestion]")).toHaveLength(1);
    const shown = [
      ...host.querySelectorAll("[data-thread-suggestion-diff]"),
    ].map((diff) => diff.textContent);
    expect(shown.join(" ")).toContain("Remove this.");
    expect(shown.join(" ")).toContain("receive");

    act(() => button("editor.acceptSuggestion").click());
    expect(onDecideUnit).toHaveBeenCalledWith(pieces, "accepted");
  });

  it("counts units, and decides each one apart, when a proposal has several", () => {
    const [first = null, second = null] = proposal();
    if (!first || !second) throw new Error("The proposal has two edits");
    const third = { ...second, id: "edit-2" };
    const label = (suggestion: ResourceSuggestion, reviewUnit: string) => ({
      ...suggestion,
      metadata: { ...suggestion.metadata, reviewUnit },
    });
    const pieces = [
      label(first, "key:0"),
      label(second, "key:1"),
      label(third, "key:1"),
    ];
    const onDecide = vi.fn();
    const onDecideUnit = vi.fn();
    render(pieces, { onDecide, onDecideUnit, onDecideRemaining: vi.fn() });
    openGroup();

    expect(
      host.querySelector("[data-suggestion-proposal] > button")?.textContent,
    ).toContain("comments.proposalEditCount");
    expect(host.querySelectorAll("[data-thread-suggestion]")).toHaveLength(2);
    act(() => button("editor.acceptSuggestion", 0).click());
    expect(onDecide).toHaveBeenCalledWith(pieces[0], "accepted");
    act(() => button("editor.acceptSuggestion", 1).click());
    expect(onDecideUnit).toHaveBeenCalledWith(
      [pieces[1], pieces[2]],
      "accepted",
    );
  });

  it("offers no group decision for a single edit", () => {
    const [only] = proposal();
    render([only!], { onDecideRemaining: vi.fn() });

    expect(button("comments.acceptAll")).toBeUndefined();
    expect(button("editor.acceptSuggestion")).toBeDefined();
  });
});
