import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: async () => undefined }),
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
  beforeEach(() => mockTrack.mockClear());

  it("emits deck_created for a blank deck", async () => {
    await addDeck.run({ deck: deck(), creationMethod: "blank" }, ctx);

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
