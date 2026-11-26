// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperationsForFindReplaceEdits } from "@shared/suggestion-diff";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ThreadSuggestionBody } from "./ThreadSuggestion";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key,
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
const edits = (count: number): ResourceSuggestion[] =>
  Array.from(
    { length: count },
    (_, index) =>
      ({
        ...proposal()[index % operations.length],
        id: `edit-${index}`,
      }) as ResourceSuggestion,
  );
const withStatus = (
  suggestion: ResourceSuggestion | undefined,
  status: ResourceSuggestion["status"],
) => ({ ...suggestion, status }) as ResourceSuggestion;

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
    canDecide?: boolean;
    onDecide?: (...args: unknown[]) => void;
    onDecideUnit?: (...args: unknown[]) => void;
    onDecideRemaining?: (...args: unknown[]) => void;
    onResolve?: () => void;
    onStep?: (suggestion: ResourceSuggestion) => void;
    conflict?: (suggestion: ResourceSuggestion) => boolean;
    busy?: (suggestion: ResourceSuggestion) => boolean;
    stickyDecision?: boolean;
  } = {},
) {
  act(() =>
    root.render(
      <TooltipProvider>
        <ThreadSuggestionBody
          suggestions={suggestions}
          canDecide={handlers.canDecide ?? true}
          busy={handlers.busy ?? (() => false)}
          conflict={handlers.conflict ?? (() => false)}
          onDecide={handlers.onDecide ?? (() => {})}
          onDecideUnit={handlers.onDecideUnit ?? (() => {})}
          {...(handlers.onDecideRemaining
            ? { onDecideRemaining: handlers.onDecideRemaining }
            : {})}
          {...(handlers.onResolve ? { onResolve: handlers.onResolve } : {})}
          {...(handlers.onStep ? { onStep: handlers.onStep } : {})}
          stickyDecision={handlers.stickyDecision ?? false}
        />
      </TooltipProvider>,
    ),
  );
}

const requiredElement = <T extends Element>(selector: string) => {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error(`Nothing matches ${selector}`);
  return found;
};

const button = (label: string, index = 0) =>
  [...host.querySelectorAll("button")].filter(
    (entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label,
  )[index]!;

const shownEdits = () =>
  [...host.querySelectorAll("[data-thread-suggestion]")].map((edit) =>
    edit.getAttribute("data-thread-suggestion"),
  );

const statuses = () =>
  [...host.querySelectorAll('[role="status"]')].map(
    (status) => status.textContent,
  );

describe("ThreadSuggestionBody", () => {
  it("shows the AI's whole note once, above each edit as its own small change", () => {
    const suggestions = proposal();
    const onDecide = vi.fn();
    const onDecideRemaining = vi.fn();
    render(suggestions, { onDecide, onDecideRemaining });

    const note = host.querySelector("[data-thread-suggestion-note]");
    expect(note?.textContent).toBe("Hyphenate Open-source");
    expect(note?.className).not.toContain("line-clamp");
    expect(host.textContent?.match(/Hyphenate Open-source/g)).toHaveLength(1);
    const diffs = [...host.querySelectorAll("[data-thread-suggestion-diff]")];
    expect(diffs.map((diff) => diff.querySelector("del")?.textContent)).toEqual(
      ["Open source ", "Open source "],
    );
    expect(diffs.map((diff) => diff.querySelector("ins")?.textContent)).toEqual(
      ["Open-source ", "Open-source "],
    );
    expect(diffs[0]!.textContent).not.toContain("Fork");

    act(() => button("comments.acceptEdit", 1).click());
    expect(onDecide).toHaveBeenCalledWith(suggestions[1], "accepted");
    act(() => button('comments.acceptEdits:{"count":2}').click());
    expect(onDecideRemaining).toHaveBeenCalledWith("accepted");
  });

  it("names each edit's Accept and Reject", () => {
    render(proposal(), { onDecideRemaining: vi.fn() });

    expect(
      [...host.querySelectorAll("[data-suggestion-decision]")].map((entry) =>
        entry.getAttribute("aria-label"),
      ),
    ).toEqual([
      "comments.acceptEdit",
      "comments.rejectEdit",
      "comments.acceptEdit",
      "comments.rejectEdit",
    ]);
  });

  it("lists up to three edits open", () => {
    render(edits(3), { onDecideRemaining: vi.fn() });

    expect(shownEdits()).toEqual(["edit-0", "edit-1", "edit-2"]);
    expect(host.querySelector("[data-suggestion-stepper]")).toBeNull();
    expect(button('comments.acceptEdits:{"count":3}')).toBeDefined();
  });

  it("shows four or more edits one at a time, each stepped to on the page", () => {
    const suggestions = edits(4);
    const onStep = vi.fn();
    render(suggestions, { onDecideRemaining: vi.fn(), onStep });

    const stepper = () => host.querySelector("[data-suggestion-stepper]");
    const step = (direction: "previous" | "next") =>
      requiredElement<HTMLButtonElement>(
        `[data-suggestion-step="${direction}"]`,
      );
    expect(shownEdits()).toEqual(["edit-0"]);
    expect(stepper()?.textContent).toContain(
      'comments.editPosition:{"index":1,"total":4}',
    );
    expect(step("previous").getAttribute("aria-label")).toBe(
      "comments.previousEdit",
    );
    expect(step("next").getAttribute("aria-label")).toBe("comments.nextEdit");
    expect(step("previous").getAttribute("aria-disabled")).toBe("true");
    expect(button('comments.acceptEdits:{"count":4}')).toBeDefined();

    act(() => step("next").click());
    expect(shownEdits()).toEqual(["edit-1"]);
    expect(onStep).toHaveBeenLastCalledWith(suggestions[1]);
    expect(stepper()?.textContent).toContain(
      'comments.editPosition:{"index":2,"total":4}',
    );

    act(() => step("next").click());
    act(() => step("next").click());
    expect(shownEdits()).toEqual(["edit-3"]);
    expect(step("next").getAttribute("aria-disabled")).toBe("true");

    act(() => step("next").click());
    expect(shownEdits()).toEqual(["edit-3"]);
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("keeps focus on Next while the keyboard steps through edits", () => {
    render(edits(6), { onDecideRemaining: vi.fn(), onStep: vi.fn() });
    const next = requiredElement<HTMLButtonElement>(
      '[data-suggestion-step="next"]',
    );
    const press = () =>
      act(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement))
          throw new Error("Nothing has focus");
        focused.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        focused.click();
      });

    next.focus();
    press();
    press();

    expect(shownEdits()).toEqual(["edit-2"]);
    expect(next.isConnected).toBe(true);
    expect(document.activeElement).toBe(next);

    press();
    press();
    press();

    expect(shownEdits()).toEqual(["edit-5"]);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(next);
  });

  it("moves on to the next edit to decide once one is decided", () => {
    const suggestions = edits(5);
    suggestions[1] = withStatus(suggestions[1], "accepted");
    const onDecide = vi.fn();
    const onStep = vi.fn();
    render(suggestions, { onDecide, onDecideRemaining: vi.fn(), onStep });

    act(() => button("comments.acceptEdit").click());

    expect(onDecide).toHaveBeenCalledWith(suggestions[0], "accepted");
    expect(onStep).toHaveBeenCalledWith(suggestions[2]);
    expect(shownEdits()).toEqual(["edit-2"]);
  });

  it("hands focus to the next edit's Accept once a stepped edit is decided", () => {
    render(edits(5), { onDecideRemaining: vi.fn(), onStep: vi.fn() });
    const accept = button("comments.acceptEdit");
    accept.focus();

    act(() => accept.click());

    expect(shownEdits()).toEqual(["edit-1"]);
    expect(accept.isConnected).toBe(false);
    expect(document.activeElement).toBe(
      requiredElement(
        '[data-thread-suggestion="edit-1"] [data-suggestion-decision="accepted"]',
      ),
    );
  });

  it("steps through a large group the AI replaced", () => {
    render(edits(5).map((suggestion) => withStatus(suggestion, "superseded")));

    expect(statuses()).toEqual(["comments.suggestionReplaced"]);
    expect(shownEdits()).toEqual(["edit-0"]);
    act(() =>
      requiredElement<HTMLButtonElement>(
        '[data-suggestion-step="next"]',
      ).click(),
    );
    expect(shownEdits()).toEqual(["edit-1"]);
  });

  it("pins a stepped group's Reject and Accept below its edit, outside the clipped edit box", () => {
    render(edits(6), { onDecideRemaining: vi.fn(), stickyDecision: true });

    const box = requiredElement<HTMLElement>("[data-suggestion-proposal]");
    const decision = requiredElement<HTMLElement>(
      "[data-suggestion-group-decision]",
    );
    expect(shownEdits()).toEqual(["edit-0"]);
    expect(box.contains(decision)).toBe(false);
    expect(
      box.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(decision.className).toMatch(/\bsticky bottom-0\b/);
    expect(decision.textContent).toContain('comments.acceptEdits:{"count":6}');

    render(edits(6), { onDecideRemaining: vi.fn() });
    expect(
      requiredElement<HTMLElement>("[data-suggestion-group-decision]")
        .className,
    ).not.toMatch(/\bsticky\b/);
  });

  it("counts what's left once some edits are decided", () => {
    const [first, second, third] = edits(3);
    const onDecideRemaining = vi.fn();
    render([{ ...first!, status: "accepted" }, second!, third!], {
      onDecideRemaining,
    });

    expect(button('comments.acceptEdits:{"count":2}')).toBeUndefined();
    expect(button('comments.acceptRemainingEdits:{"count":2}')).toBeDefined();
    act(() => button("comments.rejectEdits").click());
    expect(onDecideRemaining).toHaveBeenCalledWith("rejected");
  });

  it("never resolves the thread on accept", () => {
    const onDecideRemaining = vi.fn();
    const onResolve = vi.fn();
    render(proposal(), { onDecideRemaining, onResolve });

    expect(host.querySelector("[data-thread-suggestion-resolve]")).toBeNull();
    act(() => button('comments.acceptEdits:{"count":2}').click());

    expect(onDecideRemaining).toHaveBeenCalledWith("accepted");
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("folds accepted edits under the note, with Show and Resolve", () => {
    const onResolve = vi.fn();
    render(proposal("accepted"), { onResolve });

    expect(
      host.querySelector("[data-thread-suggestion-note]")?.textContent,
    ).toBe("Hyphenate Open-source");
    expect(statuses()).toEqual(['comments.editsAccepted:{"count":2}']);
    expect(shownEdits()).toEqual([]);
    expect(
      host.querySelector("[data-suggestion-proposal-decision]"),
    ).toBeNull();

    const show = requiredElement<HTMLButtonElement>(
      "[data-thread-suggestion-show]",
    );
    expect(show.textContent).toBe("comments.showEdits");
    expect(show.getAttribute("aria-expanded")).toBe("false");
    act(() => show.click());
    expect(shownEdits()).toEqual(["edit-0", "edit-1"]);
    expect(show.textContent).toBe("comments.hideEdits");
    expect(statuses()).toContain("comments.accepted");

    expect(host.textContent).toContain("comments.replyToKeepGoing");
    act(() => button("comments.resolve").click());
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("steps through every decided edit once there are more than three", () => {
    render(
      edits(6).map((suggestion) => withStatus(suggestion, "accepted")),
      { onResolve: vi.fn() },
    );
    expect(statuses()).toEqual(['comments.editsAccepted:{"count":6}']);

    act(() =>
      requiredElement<HTMLButtonElement>(
        "[data-thread-suggestion-show]",
      ).click(),
    );
    const next = requiredElement<HTMLButtonElement>(
      '[data-suggestion-step="next"]',
    );
    expect(
      host.querySelector("[data-suggestion-stepper]")?.textContent,
    ).toContain('comments.editPosition:{"index":1,"total":6}');
    const reached = [...shownEdits()];
    while (next.getAttribute("aria-disabled") !== "true") {
      act(() => next.click());
      reached.push(...shownEdits());
    }

    expect(reached).toEqual([
      "edit-0",
      "edit-1",
      "edit-2",
      "edit-3",
      "edit-4",
      "edit-5",
    ]);
  });

  it("brings the decided edits into view when Show opens them", async () => {
    const scrolled = vi.fn();
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element) {
        scrolled(this);
      });
    try {
      render(
        edits(6).map((suggestion) => withStatus(suggestion, "accepted")),
        { onResolve: vi.fn() },
      );
      act(() =>
        requiredElement<HTMLButtonElement>(
          "[data-thread-suggestion-show]",
        ).click(),
      );
      await act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );

      const [shown] = scrolled.mock.lastCall ?? [];
      expect(shown).toBeInstanceOf(Element);
      expect(
        (shown as Element).contains(
          requiredElement('[data-thread-suggestion="edit-0"]'),
        ),
      ).toBe(true);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it.each(["accepted", "rejected"] as const)(
    "brings the outcome into view and hands focus to Show once its group decision lands %s",
    async (decision) => {
      const scrolled = vi.fn();
      const scrollIntoView = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(function (this: Element) {
          scrolled(this);
        });
      try {
        const onDecideRemaining = vi.fn();
        const onResolve = vi.fn();
        render(edits(6), { onDecideRemaining, onResolve });
        const control = requiredElement<HTMLButtonElement>(
          `[data-suggestion-proposal-decision="${decision}"]`,
        );
        control.focus();
        act(() => control.click());
        expect(onDecideRemaining).toHaveBeenCalledWith(decision);

        render(
          edits(6).map((suggestion) => withStatus(suggestion, decision)),
          { onDecideRemaining, onResolve },
        );
        await act(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );

        const show = requiredElement("[data-thread-suggestion-show]");
        expect(document.activeElement).toBe(show);
        const [shown] = scrolled.mock.lastCall ?? [];
        expect(shown).toBeInstanceOf(Element);
        expect((shown as Element).contains(show)).toBe(true);
        expect(
          (shown as Element).contains(
            requiredElement("[data-thread-suggestion-resolve]"),
          ),
        ).toBe(true);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
      } finally {
        scrollIntoView.mockRestore();
      }
    },
  );

  it("hands focus to Show after the last edit is decided on its own", async () => {
    const [first, second] = edits(2);
    const onDecide = vi.fn();
    render([withStatus(first, "accepted"), withStatus(second, "pending")], {
      onDecide,
      onDecideRemaining: vi.fn(),
    });
    const accept = button("comments.acceptEdit");
    accept.focus();
    act(() => accept.click());
    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({ id: "edit-1" }),
      "accepted",
    );

    render([withStatus(first, "accepted"), withStatus(second, "accepted")], {
      onDecide,
      onDecideRemaining: vi.fn(),
    });
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    expect(document.activeElement).toBe(
      requiredElement("[data-thread-suggestion-show]"),
    );
  });

  it("leaves focus where it is when someone else decides the edits", async () => {
    const elsewhere = document.createElement("textarea");
    document.body.append(elsewhere);
    try {
      render(edits(4), { onDecideRemaining: vi.fn() });
      elsewhere.focus();

      render(edits(4).map((suggestion) => withStatus(suggestion, "accepted")));
      await act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );

      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("stays put when someone else decides the rest after an edit decided here", async () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    try {
      const [first, second] = edits(2);
      const onDecide = vi.fn();
      const handlers = { onDecide, onDecideRemaining: vi.fn() };
      render(
        [withStatus(first, "pending"), withStatus(second, "pending")],
        handlers,
      );
      const accept = button("comments.acceptEdit");
      accept.focus();
      act(() => accept.click());
      expect(onDecide).toHaveBeenCalledWith(
        expect.objectContaining({ id: "edit-0" }),
        "accepted",
      );
      render(
        [withStatus(first, "accepted"), withStatus(second, "pending")],
        handlers,
      );

      render(
        [withStatus(first, "accepted"), withStatus(second, "accepted")],
        handlers,
      );
      await act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(
        requiredElement("[data-thread-suggestion-show]"),
      );
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it("stays put when someone else decides edits whose decision here failed", async () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    try {
      const onDecideRemaining = vi.fn();
      render(edits(2), { onDecideRemaining });
      act(() => button('comments.acceptEdits:{"count":2}').click());
      expect(onDecideRemaining).toHaveBeenCalledWith("accepted");
      render(edits(2), { onDecideRemaining, busy: () => true });
      render(edits(2), { onDecideRemaining });

      render(
        edits(2).map((suggestion) => withStatus(suggestion, "accepted")),
        { onDecideRemaining },
      );
      await act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  it("hands focus to Show when its decision lands before saving ends", async () => {
    const onDecideRemaining = vi.fn();
    const accepted = () =>
      edits(2).map((suggestion) => withStatus(suggestion, "accepted"));
    render(edits(2), { onDecideRemaining });
    const accept = button('comments.acceptEdits:{"count":2}');
    accept.focus();
    act(() => accept.click());
    render(edits(2), { onDecideRemaining, busy: () => true });
    render(accepted(), { onDecideRemaining, busy: () => true });
    render(accepted(), { onDecideRemaining });
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    expect(document.activeElement).toBe(
      requiredElement("[data-thread-suggestion-show]"),
    );
  });

  it("says how many edits ended each way when some were rejected", () => {
    const [first, second, third] = edits(3);
    render([
      withStatus(first, "accepted"),
      withStatus(second, "rejected"),
      withStatus(third, "accepted"),
    ]);

    expect(statuses()).toEqual([
      'comments.editsAccepted:{"count":2}',
      'comments.editsRejected:{"count":1}',
    ]);
    expect(host.querySelector("[data-thread-suggestion-resolve]")).toBeNull();
  });

  it("tells a commenter the edits wait for an editor, with nothing to decide", () => {
    render(edits(4), { canDecide: false, onDecideRemaining: vi.fn() });

    expect(host.querySelector("[data-suggestion-decision]")).toBeNull();
    expect(
      host.querySelector("[data-suggestion-proposal-decision]"),
    ).toBeNull();
    const waiting = host.querySelector("[data-suggestion-group-waiting]");
    expect(waiting?.textContent).toContain("comments.waitingForEditor");
    expect(waiting?.textContent).toContain("comments.suggestionReviewReadOnly");
    expect(host.querySelector("[data-suggestion-stepper]")).not.toBeNull();
  });

  it("says a shared outcome once instead of under every edit", () => {
    render(proposal("superseded"));

    expect(statuses()).toEqual(["comments.suggestionReplaced"]);
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

    expect(button('comments.acceptEdits:{"count":2}').disabled).toBe(true);
    expect(button("comments.rejectEdits").disabled).toBe(false);
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

    expect(button('comments.acceptEdits:{"count":1}').disabled).toBe(true);
    act(() => button("comments.rejectEdits").click());

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

    expect(button("comments.acceptEdit").disabled).toBe(true);
    expect(button('comments.acceptEdits:{"count":2}').disabled).toBe(true);
    expect(button("comments.rejectEdits").disabled).toBe(false);
  });

  it("gives a unit's pieces one Accept that decides them together", () => {
    const pieces = proposal().map((suggestion) => ({
      ...suggestion,
      metadata: { ...suggestion.metadata, reviewUnit: "key:0" },
    }));
    const onDecide = vi.fn();
    const onDecideUnit = vi.fn();
    render(pieces, { onDecide, onDecideUnit });

    expect(shownEdits()).toHaveLength(1);
    expect(host.querySelector("[data-suggestion-decision]")).toBeNull();
    const diff = host.querySelector("[data-thread-suggestion-diff]");
    expect(diff?.querySelector("del")?.textContent).toBeTruthy();

    act(() => button('comments.acceptEdits:{"count":1}').click());
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

    expect(shownEdits()).toHaveLength(1);
    const shown = [
      ...host.querySelectorAll("[data-thread-suggestion-diff]"),
    ].map((diff) => diff.textContent);
    expect(shown.join(" ")).toContain("Remove this.");
    expect(shown.join(" ")).toContain("receive");

    act(() => button('comments.acceptEdits:{"count":1}').click());
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

    expect(button('comments.acceptEdits:{"count":2}')).toBeDefined();
    expect(shownEdits()).toHaveLength(2);
    act(() => button("comments.acceptEdit", 0).click());
    expect(onDecide).toHaveBeenCalledWith(pieces[0], "accepted");
    act(() => button("comments.acceptEdit", 1).click());
    expect(onDecideUnit).toHaveBeenCalledWith(
      [pieces[1], pieces[2]],
      "accepted",
    );
  });

  it("decides a single edit from the group's own Accept", () => {
    const only = proposal().slice(0, 1);
    const onDecide = vi.fn();
    render(only, { onDecide });

    expect(host.querySelector("[data-suggestion-decision]")).toBeNull();
    act(() => button('comments.acceptEdits:{"count":1}').click());
    expect(onDecide).toHaveBeenCalledWith(only[0], "accepted");
  });
});
