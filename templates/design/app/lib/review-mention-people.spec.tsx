// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reviewMentionPeople,
  useReviewMentionPeople,
} from "./review-mention-people";

const mocks = vi.hoisted(() => ({
  useOrgMembers: vi.fn(),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: mocks.useOrgMembers,
}));

const alice = { email: "alice@example.com", name: "Alice Jones" };
const shawn = { email: "shawn@example.com", name: "Shawn McClelland" };

describe("reviewMentionPeople", () => {
  it("names a person by profile name, then by the start of their address", () => {
    expect(
      reviewMentionPeople([
        alice,
        { email: "bob@example.com", name: "  " },
        { email: "cara@example.com", name: null },
        { email: "dan@example.com" },
      ]),
    ).toEqual([
      { label: "Alice Jones", email: "alice@example.com" },
      { label: "bob", email: "bob@example.com" },
      { label: "cara", email: "cara@example.com" },
      { label: "dan", email: "dan@example.com" },
    ]);
  });
});

describe("useReviewMentionPeople", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useReviewMentionPeople>;

  function Probe() {
    latest = useReviewMentionPeople();
    return null;
  }

  // Answers a search the way the server does: a page for the first page, a
  // narrowed page for a query, and nothing at all while a query is in flight.
  const answers = new Map<string, { members: unknown[] } | undefined>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    answers.clear();
    answers.set("", { members: [alice] });
    mocks.useOrgMembers.mockReset();
    mocks.useOrgMembers.mockImplementation(
      (_offset: number, query: string) => ({
        data: answers.get(query),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const lastSearch = () => mocks.useOrgMembers.mock.lastCall?.[1];
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("starts on the first page of members", () => {
    expect(mocks.useOrgMembers).toHaveBeenCalledWith(0, "");
    expect(latest.people.map((person) => person.label)).toEqual([
      "Alice Jones",
    ]);
  });

  it("asks the server for what follows the @, after the typing pauses", async () => {
    act(() => latest.onMentionQueryChange("sha"));
    await advance(199);
    expect(lastSearch()).toBe("");
    await advance(1);
    expect(lastSearch()).toBe("sha");
  });

  it("replaces the list with the server's answer for the query", async () => {
    answers.set("sha", { members: [shawn] });
    act(() => latest.onMentionQueryChange("sha"));
    await advance(200);
    expect(latest.people.map((person) => person.label)).toEqual([
      "Shawn McClelland",
    ]);
  });

  it("keeps the last list on screen while the next answer loads", async () => {
    answers.set("sha", undefined);
    act(() => latest.onMentionQueryChange("sha"));
    await advance(200);
    expect(lastSearch()).toBe("sha");
    expect(latest.people.map((person) => person.label)).toEqual([
      "Alice Jones",
    ]);
  });

  it("shows no one when the server finds no one", async () => {
    answers.set("zzz", { members: [] });
    act(() => latest.onMentionQueryChange("zzz"));
    await advance(200);
    expect(latest.people).toEqual([]);
  });

  it("goes back to the first page as soon as the picker closes", async () => {
    answers.set("sha", { members: [shawn] });
    act(() => latest.onMentionQueryChange("sha"));
    await advance(200);
    act(() => latest.onMentionQueryChange(""));
    await advance(0);
    expect(lastSearch()).toBe("");
    expect(latest.people.map((person) => person.label)).toEqual([
      "Alice Jones",
    ]);
  });
});
