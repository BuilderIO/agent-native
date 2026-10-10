import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parts: [] as Array<{ name?: string; data: Uint8Array }>,
  setResponseStatus: vi.fn(),
  resolveAuth: vi.fn(),
  getAccessToken: vi.fn(),
  track: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readMultipartFormData: async () => mocks.parts,
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("../../../handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mocks.resolveAuth(...args),
}));

vi.mock("../../../lib/google-docs-oauth.js", () => ({
  getGoogleDocsAccessToken: (...args: unknown[]) =>
    mocks.getAccessToken(...args),
}));

const text = (name: string, value: string) => ({
  name,
  data: new TextEncoder().encode(value),
});

const handler = async () =>
  (await import("./google-slides.post.js")).default({} as never);

describe("google slides export route analytics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.track.mockReset();
    mocks.setResponseStatus.mockReset();
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "user@example.com", orgId: "org-1" },
    });
    mocks.getAccessToken.mockResolvedValue({
      accessToken: "fake-access-token",
      accountEmail: "user@example.com",
    });
    mocks.resolveAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "deck-1",
        data: JSON.stringify({
          slides: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
          generationContext: { generationAttemptId: "attempt-1" },
        }),
      },
    });
    mocks.parts = [
      { name: "file", data: new Uint8Array([1, 2, 3]) },
      text("title", "Deck"),
      text("deckId", "deck-1"),
      text("renderLocation", "server"),
    ];
  });

  it("hands the analytics send to waitUntil so serverless keeps it alive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "file-1" })),
    );
    const waitUntil = vi.fn();

    await (
      await import("./google-slides.post.js")
    ).default({
      req: { waitUntil },
    } as never);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(mocks.track).toHaveBeenCalledWith(
      "deck_exported",
      expect.objectContaining({ status: "completed" }),
      { userId: "user@example.com" },
    );
  });

  it("never waits on the analytics lookup to finish the export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "file-1" })),
    );
    mocks.resolveAccess.mockReturnValue(new Promise(() => {}));

    const result = await handler();

    expect(result).toMatchObject({
      url: "https://docs.google.com/presentation/d/file-1/edit",
    });
  }, 1000);

  it("does not attribute the export to a deck the user cannot access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "file-1" })),
    );
    mocks.resolveAccess.mockResolvedValue(null);
    mocks.parts.push(
      text("slideCount", "99"),
      text("generationAttemptId", "forged"),
    );

    await handler();

    expect(mocks.track).toHaveBeenCalledTimes(1);
    const properties = mocks.track.mock.calls[0][1];
    expect(properties).toMatchObject({
      export_format: "google_slides",
      status: "completed",
    });
    expect(properties).not.toHaveProperty("output_id");
    expect(properties).not.toHaveProperty("slide_count");
    expect(properties).not.toHaveProperty("generation_attempt_id");
  });

  it("reads slide count and attempt id from the deck, not the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "file-1" })),
    );
    mocks.parts.push(
      text("slideCount", "99"),
      text("generationAttemptId", "forged"),
    );

    await handler();

    expect(mocks.track.mock.calls[0][1]).toMatchObject({
      output_id: "deck-1",
      slide_count: 4,
      generation_attempt_id: "attempt-1",
    });
  });

  it("reports one completed export after the Drive upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "file-1" })),
    );

    const result = await handler();

    expect(result).toMatchObject({
      url: "https://docs.google.com/presentation/d/file-1/edit",
    });
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track.mock.calls[0][0]).toBe("deck_exported");
    expect(mocks.track.mock.calls[0][1]).toEqual({
      output_id: "deck-1",
      output_type: "deck",
      export_format: "google_slides",
      render_location: "server",
      status: "completed",
      slide_count: 4,
      generation_attempt_id: "attempt-1",
      app_name: "slides",
      template_name: "slides",
    });
    expect(mocks.track.mock.calls[0][2]).toEqual({
      userId: "user@example.com",
    });
  });

  it("reports one failed export when Drive rejects the upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { message: "quota" } }, { status: 500 }),
      ),
    );

    await handler();

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 502);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track.mock.calls[0][1]).toMatchObject({
      export_format: "google_slides",
      status: "failed",
      error_type: "drive_upload_failed",
    });
  });

  it("reports one failed export when the browser sends no file", async () => {
    const upload = vi.fn();
    vi.stubGlobal("fetch", upload);
    mocks.parts = mocks.parts.filter((part) => part.name !== "file");

    await handler();

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(upload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.track).toHaveBeenCalled());
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track.mock.calls[0][1]).toMatchObject({
      output_id: "deck-1",
      export_format: "google_slides",
      status: "failed",
      error_type: "file_missing",
    });
  });

  it("still reports the export when the optional deck fields are absent", async () => {
    mocks.parts = [
      { name: "file", data: new Uint8Array([1]) },
      text("title", "Deck"),
    ];
    mocks.getAccessToken.mockResolvedValue(null);

    await handler();

    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track.mock.calls[0][1]).toEqual({
      output_type: "deck",
      export_format: "google_slides",
      render_location: "browser",
      status: "failed",
      error_type: "google_not_connected",
      app_name: "slides",
      template_name: "slides",
    });
  });
});
