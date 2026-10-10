import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());
const mockReadBody = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => ({ deckId: "deck-1" })),
);

vi.mock("@agent-native/core", () => ({
  isActionContractError: (error: unknown) =>
    !!error &&
    typeof error === "object" &&
    (error as { actionContractError?: unknown }).actionContractError === true &&
    typeof (error as { errorCode?: unknown }).errorCode === "string",
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
  readBody: () => mockReadBody(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

import { inGoogleSlidesBuildStep } from "../../../lib/deck-export-tracking.js";

vi.mock("../../../../actions/export-pptx.js", () => ({
  default: { run: (...args: unknown[]) => mockRun(...args) },
}));

const mockResolveAuth = vi.hoisted(() => vi.fn());

vi.mock("../../../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mockResolveAuth(...args),
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

describe("slides pptx export route", () => {
  beforeEach(() => {
    mockSetResponseStatus.mockClear();
    mockRun.mockReset();
    mockResolveAuth.mockReset();
    mockResolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "user@example.com", orgId: "org-1" },
    });
  });

  const handler = async () =>
    (await import("./pptx.post.js")).default({} as never);

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

  it("preserves a contract status that has no legacy message fallback", async () => {
    mockRun.mockRejectedValue(
      contractError("Requires editor role on deck deck-1", "forbidden", 403),
    );

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 403);
    expect(result).toMatchObject({ errorCode: "forbidden" });
  });

  it("returns 401 without invoking the action when the session has no email", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: true,
      context: { orgId: "org-1" },
    });

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 401);
    expect(result).toEqual({ error: "Unauthorized" });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns the resolver's status without invoking the action when auth fails", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      statusCode: 403,
      error: "Forbidden",
    });

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 403);
    expect(result).toEqual({ error: "Forbidden" });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("still maps an untyped legacy 'Deck not found' throw to 404", async () => {
    mockRun.mockRejectedValue(new Error("Deck not found"));

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ error: "Deck not found" });
  });

  it("marks only a Google Slides build step, without passing it to the action", async () => {
    const buildSteps: boolean[] = [];
    mockRun.mockImplementation(async () => {
      buildSteps.push(inGoogleSlidesBuildStep());
      return { buffer: Buffer.from([1]), filename: "deck.pptx" };
    });

    mockReadBody.mockResolvedValueOnce({
      deckId: "deck-1",
      exportPurpose: "google_slides",
    });
    await handler();
    mockReadBody.mockResolvedValueOnce({
      deckId: "deck-1",
      exportPurpose: "other",
    });
    await handler();

    expect(buildSteps).toEqual([true, false]);
    expect(mockRun.mock.calls[0][0]).toEqual({
      deckId: "deck-1",
      includeNotes: true,
    });
    expect(mockRun.mock.calls[1][0]).toEqual({
      deckId: "deck-1",
      includeNotes: true,
    });
  });

  it("keeps an unexpected failure a generic 500 without an errorCode", async () => {
    mockRun.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const result = await handler();

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 500);
    expect(result).not.toHaveProperty("errorCode");
  });
});
