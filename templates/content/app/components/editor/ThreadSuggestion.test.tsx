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
          onDecideRemaining={handlers.onDecideRemaining}
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

const openGroup = () =>
  act(() =>
    host
      .querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal] > button[aria-expanded]",
      )!
      .click(),
  );

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

  it("offers no group decision for a single edit", () => {
    const [only] = proposal();
    render([only!], { onDecideRemaining: vi.fn() });

    expect(button("comments.acceptAll")).toBeUndefined();
    expect(button("editor.acceptSuggestion")).toBeDefined();
  });
});
