import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  // Mirrors the real duck-typed predicate so the route is exercised the way
  // the action transport tags a `fail()`.
  isActionContractError: (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    (error as { actionContractError?: unknown }).actionContractError === true &&
    typeof (error as { errorCode?: unknown }).errorCode === "string",
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  readBody: vi.fn(async () => ({ deckId: "deck-1" })),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseHeader: vi.fn(),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../../actions/export-html.js", () => ({
  default: { run: (...args: unknown[]) => mockRun(...args) },
}));

vi.mock("../../../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: vi.fn(async () => ({
    ok: true,
    context: { email: "user@example.com", orgId: "org-1" },
  })),
}));

const contractError = (
  message: string,
  errorCode: string,
  statusCode: number,
) =>
  Object.assign(new Error(message), {
    actionContractError: true,
    errorCode,
    statusCode,
  });

describe("slides html export route", () => {
  beforeEach(() => {
    mockSetResponseStatus.mockClear();
    mockRun.mockReset();
  });

  const handler = async () =>
    (await import("./html.post.js")).default({} as never);

  it("preserves the contract status and errorCode for a missing deck", async () => {
    mockRun.mockRejectedValue(
      contractError("Deck not found: deck-1", "deck_not_found", 404),
    );

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({
      error: "Deck not found: deck-1",
      errorCode: "deck_not_found",
    });
  });

  it("preserves a 401 contract status instead of flattening it to 500", async () => {
    mockRun.mockRejectedValue(
      contractError("no authenticated user", "not_authenticated", 401),
    );

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 401);
    expect(result).toMatchObject({ errorCode: "not_authenticated" });
  });

  it("still maps an untyped legacy 'Deck not found' throw to 404", async () => {
    // `native-creative-context` raises this bare; the prefix fallback covers it.
    mockRun.mockRejectedValue(new Error("Deck not found"));

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: "Deck not found" });
  });

  it("keeps an unexpected failure a generic 500 without an errorCode", async () => {
    mockRun.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 500);
    expect(result).not.toHaveProperty("errorCode");
  });
});
