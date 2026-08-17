import { callAction } from "@agent-native/core/client/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  designPrecedentDirectives,
  loadCreativeContextPrecedent,
  type CreativeContextPrecedentMatch,
} from "./creative-context-precedent";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
}));

const mockedCallAction = vi.mocked(callAction);

function memberships(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: "mem-" + index,
    contextId: "ctx-1",
    artifactKey: null,
    status: "active",
    publishedItemId: "item-" + index,
    publishedItemVersionId: "version-" + index,
    publishedItem: {
      title: "LinkedIn ad " + index,
      kind: "document",
      canonicalUrl: null,
    },
    ...overrides,
  }));
}

function match(
  overrides: Partial<CreativeContextPrecedentMatch> = {},
): CreativeContextPrecedentMatch {
  return {
    itemId: "item-1",
    itemVersionId: "version-1",
    title: "LinkedIn ad",
    kind: "document",
    artifactKey: null,
    designResourceId: null,
    ...overrides,
  };
}

describe("loadCreativeContextPrecedent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads nothing when the user picked no context", async () => {
    await expect(loadCreativeContextPrecedent(null)).resolves.toEqual({
      status: "none",
    });
    expect(mockedCallAction).not.toHaveBeenCalled();
  });

  it("loads the picked context's published members", async () => {
    mockedCallAction.mockResolvedValue({ memberships: memberships(3) });

    const precedent = await loadCreativeContextPrecedent("ctx-1");

    expect(precedent.status).toBe("strong");
    expect(mockedCallAction).toHaveBeenCalledWith(
      "list-context-memberships",
      expect.objectContaining({ contextId: "ctx-1", status: "active" }),
      { method: "GET" },
    );
  });

  it("extracts the design id from a native design membership", async () => {
    mockedCallAction.mockResolvedValue({
      memberships: memberships(1, {
        artifactKey: "design:design:dsn_123",
        publishedItem: {
          title: "Launch ad",
          kind: "design-project",
          canonicalUrl: "/design/dsn_123",
        },
      }),
    });

    const precedent = await loadCreativeContextPrecedent("ctx-1");

    expect(
      precedent.status === "strong"
        ? precedent.matches[0].designResourceId
        : null,
    ).toBe("dsn_123");
  });

  it("does not treat a foreign artifact key as clonable", async () => {
    mockedCallAction.mockResolvedValue({
      memberships: memberships(1, {
        artifactKey: "figma:file:abc",
        publishedItem: {
          title: "Brand deck",
          kind: "document",
          canonicalUrl: "/design/dsn_123",
        },
      }),
    });

    const precedent = await loadCreativeContextPrecedent("ctx-1");

    expect(
      precedent.status === "strong"
        ? precedent.matches[0].designResourceId
        : "unset",
    ).toBeNull();
  });

  it("distinguishes an empty context from an unreadable one", async () => {
    mockedCallAction.mockResolvedValue({ memberships: [] });
    await expect(loadCreativeContextPrecedent("ctx-1")).resolves.toEqual({
      status: "empty",
      contextId: "ctx-1",
    });

    mockedCallAction.mockRejectedValue(new Error("context unreachable"));
    await expect(loadCreativeContextPrecedent("ctx-1")).resolves.toEqual({
      status: "unavailable",
      contextId: "ctx-1",
      reason: "context unreachable",
    });
  });
});

describe("designPrecedentDirectives", () => {
  it("prefers cloning a prior design over reading code", () => {
    const directives = designPrecedentDirectives("ctx-1", [
      match({
        kind: "design-project",
        artifactKey: "design:design:dsn_123",
        designResourceId: "dsn_123",
      }),
    ]).join("\n");

    expect(directives).toContain("clone-creative-context-design-native");
    expect(directives).toContain("ctx-1");
    expect(directives).toContain("design:design:<resourceId>");
    expect(directives).toContain("dsn_123");
    expect(directives).toContain("search-replace");
    expect(directives).toContain("canvasFrames width and height");
    expect(directives).toContain("Do not use replace-file");
    expect(directives).toContain("delete-file");
    expect(directives).toContain(
      "delete-design on every clone you did not keep",
    );
    expect(directives).not.toContain("get-context-item");
  });

  it("falls back to reading pinned versions when nothing is clonable", () => {
    const directives = designPrecedentDirectives("ctx-1", [match()]).join("\n");

    expect(directives).toContain("get-context-item");
    expect(directives).not.toContain("clone-creative-context-design-native");
  });
});
