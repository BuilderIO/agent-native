import {
  callAction,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function results(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    itemId: "item-" + index,
    itemVersionId: "version-" + index,
    title: "LinkedIn ad " + index,
    kind: "document",
    canonicalUrl: null,
    nativeArtifact: null,
    ...overrides,
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
    kind: "document",
    nativeFormat: null,
    designResourceId: null,
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
    expect(mockedCallAction).toHaveBeenCalledWith(
      "search-creative-context",
      expect.objectContaining({ snapshot: false, matchMode: "anyTerm" }),
    );
  });

  it("extracts the design id from a native design submission", async () => {
    mockedCallAction.mockResolvedValue({
      results: results(3, {
        kind: "design-project",
        canonicalUrl: "/design/dsn_123",
      }),
      coverage: coverage({ lexical: 3 }),
    });

    const precedent = await probeCreativeContextPrecedent("linkedin ad");

    expect(
      precedent.status === "strong"
        ? precedent.matches[0].designResourceId
        : null,
    ).toBe("dsn_123");
  });

  it("does not treat a non-design kind as clonable", async () => {
    mockedCallAction.mockResolvedValue({
      results: results(3, { canonicalUrl: "/design/dsn_123" }),
      coverage: coverage({ lexical: 3 }),
    });

    const precedent = await probeCreativeContextPrecedent("linkedin ad");

    expect(
      precedent.status === "strong"
        ? precedent.matches[0].designResourceId
        : "unset",
    ).toBeNull();
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
  it("prefers cloning a prior design over reading code", () => {
    const directives = designPrecedentDirectives([
      match({
        kind: "design-project",
        designResourceId: "dsn_123",
        nativeFormat: "design-html",
      }),
    ]).join("\n");

    expect(directives).toContain("clone-creative-context-design-native");
    expect(directives).toContain("design:design:<resourceId>");
    expect(directives).toContain("dsn_123");
    expect(directives).not.toContain("get-context-item");
  });

  it("falls back to reading native code when nothing is clonable", () => {
    const directives = designPrecedentDirectives([
      match({ nativeFormat: "design-html" }),
    ]).join("\n");

    expect(directives).toContain("get-context-item");
    expect(directives).not.toContain("clone-creative-context-design-native");
  });

  it("tells the agent to admit when only text excerpts exist", () => {
    const directives = designPrecedentDirectives([match()]).join("\n");

    expect(directives).toContain("only have text excerpts");
    expect(directives).not.toContain("get-context-item");
  });
});
