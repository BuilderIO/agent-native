import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: (...args: unknown[]) => mockInsertValues(...args),
    }),
  }),
  schema: { decks: {} },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: vi.fn(),
}));

vi.mock("./_deck-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_deck-write.js")>();
  return {
    ...actual,
    assertDesignSystemReadable: () => Promise.resolve(),
  };
});

import addDeck from "./add-deck";

const ctx = { caller: "frontend" } as never;

function deck(extra: Record<string, unknown> = {}) {
  return {
    id: "deck-1",
    title: "Untitled",
    slides: [{ id: "s1", content: "<div>One</div>" }],
    ...extra,
  };
}

function trackedNames() {
  return mockTrack.mock.calls.map(([name]) => name);
}

describe("add-deck tracking", () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockInsertValues.mockClear();
  });

  it("emits deck_created for a blank deck", async () => {
    const payload = deck();
    await addDeck.run({ deck: payload, creationMethod: "blank" }, ctx);

    expect(payload.appId).toBe("slides-2");
    expect(mockInsertValues.mock.calls[0]?.[0]).toMatchObject({
      data: expect.stringContaining('"appId":"slides-2"'),
    });

    expect(trackedNames()).toEqual(["deck_created"]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      output_id: "deck-1",
      output_type: "deck",
      creation_method: "blank",
      purpose: "direct",
      slide_count: 1,
      caller: "frontend",
    });
  });

  it("rejects an explicitly foreign app payload before insertion", async () => {
    await expect(
      addDeck.run({ deck: deck({ appId: "slides" }) }, ctx),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("records an unknown method rather than guessing when none is passed", async () => {
    await addDeck.run(
      { deck: deck({ generationContext: { generationAttemptId: "a-1" } }) },
      ctx,
    );

    expect(mockTrack.mock.calls[0]?.[0]).toBe("deck_created");
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      creation_method: "unknown",
      purpose: "unknown",
    });
  });

  it("records a generated deck once, with its start", async () => {
    await addDeck.run(
      {
        deck: deck({
          slides: [],
          generationContext: {
            originalPrompt: "A deck",
            files: [],
            generationAttemptId: "attempt-1",
            mode: "new",
          },
        }),
        creationMethod: "generated",
      },
      ctx,
    );

    expect(trackedNames()).toEqual(["deck_created", "deck_creation_started"]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      creation_method: "generated",
      purpose: "direct",
      slide_count: 0,
      generation_attempt_id: "attempt-1",
    });
    expect(mockTrack.mock.calls[1]?.[1]).toMatchObject({
      generation_attempt_id: "attempt-1",
      is_retry: false,
    });
  });

  it("records the method and purpose it is told for imports and templates", async () => {
    await addDeck.run(
      {
        deck: deck({ slides: [] }),
        creationMethod: "import_docx",
        purpose: "reference",
      },
      ctx,
    );
    await addDeck.run({ deck: deck(), creationMethod: "template" }, ctx);

    expect(trackedNames()).toEqual(["deck_created", "deck_created"]);
    expect(mockTrack.mock.calls[0]?.[1]).toMatchObject({
      creation_method: "import_docx",
      purpose: "reference",
      slide_count: 0,
    });
    expect(mockTrack.mock.calls[1]?.[1]).toMatchObject({
      creation_method: "template",
      purpose: "direct",
    });
  });
});
