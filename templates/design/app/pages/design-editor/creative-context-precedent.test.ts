import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callAction,
  readClientAppState,
} from "@agent-native/core/client/hooks";

import {
  designPrecedentDirectives,
  probeCreativeContextPrecedent,
  type CreativeContextPrecedentMatch,
} from "./creative-context-precedent";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  readClientAppState: vi.fn(),
}));

const mockedCallAction = vi.mocked(callAction);
const mockedReadAppState = vi.mocked(readClientAppState);

function results(count: number, withNativeCode = false) {
  return Array.from({ length: count }, (_, index) => ({
    itemId: "item-" + index,
    itemVersionId: "version-" + index,
    title: "LinkedIn ad " + index,
    kind: "design",
    nativeArtifact: withNativeCode
      ? { app: "design", format: "design-html" }
      : null,
  }));
}

function coverage(lanes: { lexical?: number; fts?: number; vector?: number }) {
  return {
    lanes: {
      lexical: { count: lanes.lexical ?? 0 },
      fts: { count: lanes.fts ?? 0 },
      vector: { count: lanes.vector ?? 0 },
    },
  };
}

function match(
  overrides: Partial<CreativeContextPrecedentMatch> = {},
): CreativeContextPrecedentMatch {
  return {
    itemId: "item-1",
    itemVersionId: "version-1",
    title: "LinkedIn ad",
    kind: "design",
    nativeFormat: null,
    ...overrides,
  };
}

describe("probeCreativeContextPrecedent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedReadAppState.mockResolvedValue({ contextMode: "auto" });
  });

  it("skips the search entirely when creative context is off", async () => {
    mockedReadAppState.mockResolvedValue({ contextMode: "off" });

    await expect(probeCreativeContextPrecedent("linkedin ad")).resolves.toEqual(
      { status: "off" },
    );
    expect(mockedCallAction).not.toHaveBeenCalled();
  });

  it("reports strong precedent for enough literally matching items", async () => {
    mockedCallAction.mockResolvedValue({
      results: results(4),
      coverage: coverage({ lexical: 6 }),
    });

    const precedent = await probeCreativeContextPrecedent("linkedin ad");

    expect(precedent.status).toBe("strong");
    expect(precedent.status === "strong" ? precedent.matches : []).toHaveLength(
      4,
    );
    expect(mockedCallAction).toHaveBeenCalledWith(
      "search-creative-context",
      expect.objectContaining({ snapshot: false, matchMode: "anyTerm" }),
    );
  });

  it("carries the native artifact format through to matches", async () => {
    mockedCallAction.mockResolvedValue({
      results: results(3, true),
      coverage: coverage({ lexical: 3 }),
    });

    const precedent = await probeCreativeContextPrecedent("linkedin ad");

    expect(
      precedent.status === "strong" ? precedent.matches[0].nativeFormat : null,
    ).toBe("design-html");
  });

  it("counts each item once when several chunks match", async () => {
    mockedCallAction.mockResolvedValue({
      results: [...results(2), ...results(2)],
      coverage: coverage({ lexical: 4 }),
    });

    await expect(probeCreativeContextPrecedent("linkedin ad")).resolves.toEqual(
      { status: "insufficient", matchCount: 2 },
    );
  });

  it("does not treat vector-only neighbours as precedent", async () => {
    mockedCallAction.mockResolvedValue({
      results: results(5),
      coverage: coverage({ vector: 5 }),
    });

    await expect(probeCreativeContextPrecedent("linkedin ad")).resolves.toEqual(
      { status: "insufficient", matchCount: 5 },
    );
  });

  it("distinguishes a failed probe from an empty library", async () => {
    mockedCallAction.mockRejectedValue(new Error("search index offline"));

    await expect(probeCreativeContextPrecedent("linkedin ad")).resolves.toEqual(
      { status: "unavailable", reason: "search index offline" },
    );
  });
});

describe("designPrecedentDirectives", () => {
  it("names the exact ids to retrieve when artifacts carry code", () => {
    const directives = designPrecedentDirectives([
      match({ nativeFormat: "design-html" }),
    ]).join("\n");

    expect(directives).toContain("get-context-item");
    expect(directives).toContain("version-1");
    expect(directives).not.toContain("only have text excerpts");
  });

  it("tells the agent to admit when only text excerpts exist", () => {
    const directives = designPrecedentDirectives([match()]).join("\n");

    expect(directives).toContain("only have text excerpts");
    expect(directives).not.toContain("get-context-item");
  });
});
