import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  resolveAuth: vi.fn(),
}));

vi.mock("fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@agent-native/core", () => ({
  isActionContractError: () => false,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
  streamFile: vi.fn(),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: () => mocks.query(),
  getRouterParam: () => "missing-export.pptx",
  setResponseHeader: (...args: unknown[]) => mocks.setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));
vi.mock("../../../../actions/export-pptx.js", () => ({
  default: { run: (...args: unknown[]) => mocks.run(...args) },
}));
vi.mock("../../../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mocks.resolveAuth(...args),
}));

describe("slides hosted PPTX download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stat.mockRejectedValue(new Error("ENOENT"));
    mocks.query.mockReturnValue({ deckId: "deck-1", includeNotes: "false" });
    mocks.run.mockResolvedValue({
      buffer: Buffer.from("pptx-bytes"),
      filename: "deck-export.pptx",
    });
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "user@example.com", orgId: "org-1" },
    });
  });

  it("regenerates a missing serverless export after checking the user session", async () => {
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="deck-export.pptx"',
    );
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      "pptx-bytes",
    );
    expect(mocks.run).toHaveBeenCalledWith(
      { deckId: "deck-1", includeNotes: false },
      {
        caller: "http",
        userEmail: "user@example.com",
        orgId: "org-1",
      },
    );
  });
});
