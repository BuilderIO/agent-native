import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWebsite = vi.hoisted(() => vi.fn());
vi.mock(
  "@agent-native/core/server",
  () => import("../../../packages/core/src/server/composer-website-source.js"),
);
vi.mock("./import-from-url.js", () => ({ default: { run: mockWebsite } }));

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  peer: vi.fn(),
  list: vi.fn(),
  reference: vi.fn(),
}));
vi.mock("@agent-native/core/a2a", () => ({
  readPeerComposerSource: mocks.peer,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.user,
}));
vi.mock(
  "@agent-native/core/shared",
  () => import("../../../packages/core/src/shared/composer-source.js"),
);
vi.mock("./list-decks.js", () => ({ default: { run: mocks.list } }));
vi.mock("./get-deck-reference-context.js", () => ({
  default: { run: mocks.reference },
}));

import action from "./read-composer-source.js";

describe("local website references", () => {
  it("reads partial website context locally without peer discovery", async () => {
    mockWebsite.mockResolvedValue({
      status: "partial",
      designMd: "# Website",
      warnings: ["Static extraction only."],
    });
    const result = await action.run({
      source: "website",
      operation: "read",
      url: "https://example.com",
      page: 1,
    });
    expect(result).toMatchObject({
      url: "https://example.com/",
      context: expect.stringContaining("Extraction status: partial"),
    });
    expect(mocks.peer).not.toHaveBeenCalled();
  });
  it("fails when the extractor returns failed instead of throwing", async () => {
    mockWebsite.mockResolvedValue({
      status: "failed",
      error: "private extraction diagnostics",
    });
    await expect(
      action.run({
        source: "website",
        operation: "read",
        url: "https://example.com",
        page: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "composer_website_extraction_failed",
    });
  });
});

const input = {
  source: "slides",
  operation: "read",
  id: "deck-example",
  page: 1,
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockReturnValue("member@example.com");
});

describe("Slides composer references", () => {
  it("exposes only an authenticated read contract to peers", () => {
    expect(action).toMatchObject({
      readOnly: true,
      mcpTool: true,
      http: { method: "GET" },
      publicAgent: { expose: true, readOnly: true, requiresAuth: true },
    });
  });

  it("does not relay a peer back out to another app", async () => {
    await expect(
      action.run({ ...input, source: "design" }, { caller: "a2a" }),
    ).rejects.toMatchObject({ errorCode: "composer_source_wrong_app" });
    expect(mocks.peer).not.toHaveBeenCalled();
  });

  it("requires identity before reading local or peer references", async () => {
    mocks.user.mockReturnValue(undefined);
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "unauthorized",
    });
    expect(mocks.reference).not.toHaveBeenCalled();
    expect(mocks.peer).not.toHaveBeenCalled();
  });

  it("lists scoped metadata and preserves search/cursors", async () => {
    mocks.list.mockResolvedValue({
      decks: [{ id: "d1", title: "Example" }],
      nextCursor: "next-page",
    });
    expect(
      await action.run({
        ...input,
        operation: "list",
        search: "example",
        cursor: "previous-page",
      }),
    ).toEqual({
      items: [{ id: "d1", title: "Example" }],
      hasMore: true,
      nextCursor: "next-page",
    });
    expect(mocks.list).toHaveBeenCalledWith(
      { limit: 30, search: "example", cursor: "previous-page" },
      undefined,
    );
  });

  it("reads through the existing access-checked deck reference action", async () => {
    mocks.reference.mockResolvedValue({
      id: "deck-example",
      title: "Example",
      agentContext: "Layout patterns",
    });
    expect(await action.run(input)).toMatchObject({
      id: "deck-example",
      context: expect.stringContaining("Layout patterns"),
    });
    expect(mocks.reference).toHaveBeenCalledWith(
      { id: "deck-example" },
      undefined,
    );
  });

  it("does not replace a denied or deleted deck with empty context", async () => {
    mocks.reference.mockRejectedValue(new Error("Deck not found"));
    await expect(action.run(input)).rejects.toThrow("Deck not found");
  });

  it.each(["design", "figma"] as const)(
    "delegates %s reads through the verified peer contract",
    async (source) => {
      const args = { ...input, source };
      mocks.peer.mockResolvedValue({
        id: "reference-example",
        title: "Example",
        context: "Reference",
      });
      await action.run(args);
      expect(mocks.peer).toHaveBeenCalledWith(args, "slides");
      expect(mocks.reference).not.toHaveBeenCalled();
    },
  );

  it("requires a selected deck", async () => {
    await expect(action.run({ ...input, id: undefined })).rejects.toMatchObject(
      { errorCode: "composer_reference_required" },
    );
  });
});
