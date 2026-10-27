import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  insertValues: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
  getRequestOrgId: vi.fn(() => null),
  track: vi.fn(),
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), {
      name: "ActionContractError",
      actionContractError: true,
      errorCode: options.errorCode ?? "action_failed",
      statusCode: options.statusCode ?? 400,
      ...(options.details === undefined ? {} : { details: options.details }),
    });
  },
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: Record<string, unknown> = {}) =>
    mocks.fail(message, options),
}));

vi.mock("@agent-native/core", () => ({
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.getRequestUserEmail(),
  getRequestOrgId: () => mocks.getRequestOrgId(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mocks.insertValues }),
  }),
  schema: { decks: {} },
}));

vi.mock("./_app-url.js", () => ({
  getDeckUrl: (deckId: string) => `/deck/${deckId}`,
}));

import action from "./duplicate-deck.js";

const storedDecks = new Map<string, Record<string, unknown>>();
let sourceResource: Record<string, unknown>;
let sourceId: string;

describe("duplicate-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedDecks.clear();
    sourceId = "deck-source";
    sourceResource = {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "BoD Recap",
      designSystemId: null,
      data: JSON.stringify({
        id: "deck-source",
        appId: "slides-2",
        title: "BoD Recap",
        sourceImport: {
          mode: "source-preserving",
          format: "pdf",
          slideIds: ["source-slide-1"],
          slides: [{ id: "source-slide-1" }],
        },
        slides: [{ id: "source-slide-1", content: "<div />" }],
      }),
    };
    mocks.resolveAccess.mockImplementation(async (_type, id) => {
      if (id === sourceId) return { resource: sourceResource };
      const resource = storedDecks.get(String(id));
      return resource ? { resource } : null;
    });
    mocks.insertValues.mockImplementation(async (values) => {
      const row = values as Record<string, unknown>;
      storedDecks.set(String(row.id), {
        ...row,
        ownerEmail: "owner@example.com",
        orgId: null,
      });
    });
  });

  it("marks only copies with a supplied ID safe to retry", () => {
    expect(action.retrySafe).toBeTypeOf("function");
    expect(action.retrySafe?.({ deckId: "deck-source", newId: "copy" })).toBe(
      true,
    );
    expect(action.retrySafe?.({ deckId: "deck-source" })).toBe(false);
  });

  it("preserves source provenance on a copied deck", async () => {
    const result = await action.run({
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    });

    const insertedData = JSON.parse(
      mocks.insertValues.mock.calls[0]?.[0].data as string,
    );
    expect(insertedData.id).toBe("deck-copy");
    expect(result).toMatchObject({ id: "deck-copy", reused: false });
    expect(insertedData.sourceImport).toMatchObject({
      slideIds: ["slide-copy"],
      slides: [{ id: "slide-copy" }],
    });
    expect(insertedData.appId).toBe("slides-2");
    expect(insertedData.slides).toEqual([
      { id: "slide-copy", content: "<div />" },
    ]);
    expect(mocks.resolveAccess.mock.calls).toEqual([
      ["deck", "deck-copy"],
      ["deck", "deck-source"],
      ["deck", "deck-copy"],
    ]);
  });

  it("creates a private copy without reusing source share metadata", async () => {
    sourceResource = {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "Shared deck",
      designSystemId: null,
      data: JSON.stringify({
        id: "deck-source",
        appId: "slides-2",
        title: "Shared deck",
        visibility: "public",
        shareToken: "source-token",
        slides: [{ id: "slide-source", content: "<div />" }],
      }),
    };

    await action.run({
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    });

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as {
      data: string;
      visibility: string;
    };
    expect(inserted.visibility).toBe("private");
    const insertedData = JSON.parse(inserted.data);
    expect(insertedData.visibility).toBe("private");
    expect(insertedData).not.toHaveProperty("shareToken");
  });

  it("returns a typed not-found failure when the source is inaccessible", async () => {
    mocks.resolveAccess.mockImplementation(async () => null);

    await expect(
      action.run({ deckId: "missing-deck", newId: "deck-copy" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "deck_not_found",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rejects duplicate client slide IDs with a typed validation failure", async () => {
    sourceResource = {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "Two slides",
      designSystemId: null,
      data: JSON.stringify({
        id: "deck-source",
        appId: "slides-2",
        slides: [{ id: "slide-1" }, { id: "slide-2" }],
      }),
    };

    await expect(
      action.run({
        deckId: "deck-source",
        newId: "deck-copy",
        slideIds: ["duplicate", "duplicate"],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_slide_ids",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("does not duplicate a deck explicitly owned by another app", async () => {
    sourceId = "foreign-deck";
    sourceResource = {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "Foreign deck",
      designSystemId: null,
      data: JSON.stringify({ appId: "slides", slides: [] }),
    };

    await expect(
      action.run({ deckId: "foreign-deck", newId: "copy" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("does not duplicate a markerless legacy deck", async () => {
    sourceId = "legacy-deck";
    sourceResource = {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "Legacy deck",
      designSystemId: null,
      data: JSON.stringify({ slides: [] }),
    };

    await expect(
      action.run({ deckId: "legacy-deck", newId: "copy" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("reports the copy as a duplicated deck", async () => {
    await action.run({ deckId: "deck-source", newId: "deck-copy" }, {
      caller: "frontend",
    } as never);

    expect(mocks.track).toHaveBeenCalledWith(
      "deck_created",
      expect.objectContaining({
        output_id: "deck-copy",
        output_type: "deck",
        creation_method: "duplicate",
        purpose: "direct",
        slide_count: 1,
        caller: "frontend",
      }),
      { caller: "frontend" },
    );
  });

  it("reuses a stable copy ID without overwriting subsequent edits", async () => {
    const input = {
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    };
    await action.run(input);

    const savedCopy = storedDecks.get("deck-copy")!;
    const editedData = JSON.parse(savedCopy.data as string);
    editedData.title = "Edited after duplication";
    editedData.slides[0].content = "<div>Later edit</div>";
    savedCopy.data = JSON.stringify(editedData);
    savedCopy.title = "Edited after duplication";

    const retried = await action.run(input);

    expect(retried).toMatchObject({
      id: "deck-copy",
      title: "Edited after duplication",
      reused: true,
    });
    expect(mocks.insertValues).toHaveBeenCalledOnce();
    expect(
      JSON.parse(storedDecks.get("deck-copy")!.data as string),
    ).toMatchObject({
      title: "Edited after duplication",
      slides: [{ content: "<div>Later edit</div>" }],
    });
  });

  it("rejects reuse of a stable copy ID for different request arguments", async () => {
    storedDecks.set("deck-copy", {
      ownerEmail: "owner@example.com",
      orgId: null,
      title: "Earlier copy",
      data: JSON.stringify({
        id: "deck-copy",
        appId: "slides-2",
        duplicateRequest: { sourceDeckId: "deck-source", hash: "other" },
        slides: [],
      }),
    });

    await expect(
      action.run({ deckId: "deck-source", newId: "deck-copy" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "deck_copy_id_conflict",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("recovers a concurrent insert with the same stable request", async () => {
    mocks.insertValues.mockImplementationOnce(async (values) => {
      const row = values as Record<string, unknown>;
      storedDecks.set(String(row.id), {
        ...row,
        ownerEmail: "owner@example.com",
        orgId: null,
      });
      throw Object.assign(new Error("unique violation"), { code: "23505" });
    });

    const result = await action.run({
      deckId: "deck-source",
      newId: "deck-copy",
      slideIds: ["slide-copy"],
    });

    expect(result).toMatchObject({ id: "deck-copy", reused: true });
    expect(mocks.insertValues).toHaveBeenCalledOnce();
  });

  it("rejects a supplied slide ID list with the wrong length", async () => {
    sourceResource = {
      ...sourceResource,
      data: JSON.stringify({
        id: "deck-source",
        appId: "slides-2",
        slides: [{ id: "slide-1" }, { id: "slide-2" }],
      }),
    };

    await expect(
      action.run({
        deckId: "deck-source",
        newId: "deck-copy",
        slideIds: ["slide-copy"],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_slide_ids",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
