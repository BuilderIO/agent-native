// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  enqueueSuggestionDecision,
  queuedSuggestionDecisions,
  suggestionDecisionsSettled,
  suggestionDecisionView,
  useSuggestionDecisionView,
  type QueuedSuggestionDecision,
  type SuggestionDecisionView,
} from "./suggestion-decision-queue";

function entry(key: string): QueuedSuggestionDecision {
  return {
    key,
    proposalId: null,
    decision: "accepted",
    members: [{ id: key } as ResourceSuggestion],
    beforeContent: "",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function unloadBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("suggestion decision queue", () => {
  it("sends decisions one at a time in click order", async () => {
    const started: string[] = [];
    const gates = new Map([
      ["one", deferred()],
      ["two", deferred()],
    ]);
    const run = async (queued: QueuedSuggestionDecision) => {
      started.push(queued.key);
      await gates.get(queued.key)!.promise;
    };
    enqueueSuggestionDecision("order", entry("one"), run);
    enqueueSuggestionDecision("order", entry("two"), run);
    await Promise.resolve();
    expect(started).toEqual(["one"]);
    expect(queuedSuggestionDecisions("order").map((e) => e.key)).toEqual([
      "one",
      "two",
    ]);
    gates.get("one")!.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(started).toEqual(["one", "two"]);
    expect(queuedSuggestionDecisions("order").map((e) => e.key)).toEqual([
      "two",
    ]);
    gates.get("two")!.resolve();
    await suggestionDecisionsSettled("order");
    expect(queuedSuggestionDecisions("order")).toEqual([]);
  });

  it("keeps each Page's decisions apart", async () => {
    const gate = deferred();
    enqueueSuggestionDecision("page-a", entry("a"), () => gate.promise);
    expect(queuedSuggestionDecisions("page-a")).toHaveLength(1);
    expect(queuedSuggestionDecisions("page-b")).toEqual([]);
    gate.resolve();
    await suggestionDecisionsSettled("page-a");
  });

  it("waits for decisions queued while it waits", async () => {
    const first = deferred();
    const second = deferred();
    let settled = false;
    enqueueSuggestionDecision("later", entry("first"), () => first.promise);
    const settling = suggestionDecisionsSettled("later").then(() => {
      settled = true;
    });
    enqueueSuggestionDecision("later", entry("second"), () => second.promise);
    first.resolve();
    await new Promise((done) => setTimeout(done, 0));
    expect(settled).toBe(false);
    second.resolve();
    await settling;
    expect(settled).toBe(true);
  });

  it("removes a decision whose send throws", async () => {
    enqueueSuggestionDecision("throws", entry("bad"), async () => {
      throw new Error("network");
    });
    await suggestionDecisionsSettled("throws");
    expect(queuedSuggestionDecisions("throws")).toEqual([]);
  });

  it("asks before closing the tab while a decision is saving", async () => {
    expect(unloadBlocked()).toBe(false);
    const gate = deferred();
    enqueueSuggestionDecision("unload", entry("saving"), () => gate.promise);
    expect(unloadBlocked()).toBe(true);
    gate.resolve();
    await suggestionDecisionsSettled("unload");
    expect(unloadBlocked()).toBe(false);
  });

  it("hands a Page back to the editor still showing it when another closes", async () => {
    const view = (): SuggestionDecisionView => ({
      failed() {},
      decided() {},
      catchUp: async () => true,
      placements: async () => ({}),
    });
    function Editor({ view }: { view: SuggestionDecisionView }) {
      useSuggestionDecisionView("two-editors", view);
      return null;
    }
    const first = view();
    const second = view();
    const firstRoot = createRoot(document.createElement("div"));
    const secondRoot = createRoot(document.createElement("div"));
    await act(async () =>
      firstRoot.render(createElement(Editor, { view: first })),
    );
    await act(async () =>
      secondRoot.render(createElement(Editor, { view: second })),
    );
    expect(suggestionDecisionView("two-editors")).toBe(second);
    await act(async () => secondRoot.unmount());
    expect(suggestionDecisionView("two-editors")).toBe(first);
    await act(async () => firstRoot.unmount());
    expect(suggestionDecisionView("two-editors")).toBeNull();
  });
});
