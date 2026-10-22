import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_PPTX_EXPORT_TTL_MS,
  PPTX_DECK_BINDING_FILE_SUFFIX,
  pptxDeckBindingKey,
  pptxExportRevisionKey,
  safeGeneratedFilename,
} from "../../../lib/tenant-files.js";

const deckData = JSON.stringify({ slides: [{ id: "s1", content: "" }] });
const exportRevision = pptxExportRevisionKey(
  "deck-1",
  null,
  "Deck",
  deckData,
  false,
);

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
  filename: "",
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  resolveAuth: vi.fn(),
  resolveAccess: vi.fn(),
  createReadStream: vi.fn(),
  streamFile: vi.fn((..._args: unknown[]) => "streamed-export"),
}));

vi.mock("fs", () => ({ createReadStream: mocks.createReadStream }));
vi.mock("fs/promises", () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
}));
vi.mock("@agent-native/core", () => ({
  isActionContractError: () => false,
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
  streamFile: (...args: unknown[]) => mocks.streamFile(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: () => mocks.query(),
  getRouterParam: () => mocks.filename,
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
    mocks.filename = safeGeneratedFilename(
      "requested-export",
      ".pptx",
      "deck-1",
    );
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    mocks.readFile.mockResolvedValue(exportRevision);
    mocks.query.mockReturnValue({
      deckId: "deck-1",
      includeNotes: "false",
      exportRevision,
    });
    mocks.run.mockImplementation(
      async (
        _args: unknown,
        context: { slidesPptxDownloadFilename: string },
      ) => ({
        buffer: Buffer.from("pptx-bytes"),
        filename: context.slidesPptxDownloadFilename,
      }),
    );
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "user@example.com", orgId: "org-1" },
    });
    mocks.resolveAccess.mockResolvedValue({ resource: { id: "deck-1" } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("regenerates a missing serverless export under the requested filename after checking the user session", async () => {
    expect(mocks.filename).toContain(`-${pptxDeckBindingKey("deck-1")}.pptx`);
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${mocks.filename}"`,
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
        slidesPptxDownload: true,
        slidesPptxDownloadFilename: mocks.filename,
        slidesPptxDownloadPersist: true,
        slidesPptxDownloadExpectedRevision: exportRevision,
      },
    );
  });

  it("reuses a persisted export after the first authenticated regeneration", async () => {
    vi.stubEnv("NETLIFY", "true");
    mocks.stat
      .mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      )
      .mockResolvedValueOnce({ size: 12, mtimeMs: Date.now() });
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const regenerated = await handler({});
    const streamed = await handler({});

    expect(regenerated).toBeInstanceOf(Response);
    expect(streamed).toBe("streamed-export");
    expect(mocks.createReadStream).toHaveBeenCalledWith(
      expect.stringContaining(mocks.filename),
    );
    expect(mocks.streamFile).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenCalledWith("deck", "deck-1");
  });

  it("regenerates an expired hosted cache entry under the same revision-bound URL", async () => {
    vi.stubEnv("NETLIFY", "true");
    mocks.stat.mockResolvedValue({
      size: 12,
      mtimeMs: Date.now() - HOSTED_PPTX_EXPORT_TTL_MS - 1,
    });
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response).toBeInstanceOf(Response);
    expect(mocks.run).toHaveBeenCalledWith(
      { deckId: "deck-1", includeNotes: false },
      expect.objectContaining({
        slidesPptxDownloadFilename: mocks.filename,
        slidesPptxDownloadExpectedRevision: exportRevision,
      }),
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("rejects old download URLs that do not identify an export revision", async () => {
    mocks.query.mockReturnValue({ deckId: "deck-1", includeNotes: "false" });
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({
      error: "Export revision is missing. Export the deck again.",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 409);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("does not stream a cached export after deck access is revoked", async () => {
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() });
    mocks.resolveAccess.mockResolvedValue(null);
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({ error: "Not found" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404);
    expect(mocks.resolveAccess).toHaveBeenCalledWith("deck", "deck-1");
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not serve a cached export under a different accessible deck id", async () => {
    mocks.filename = safeGeneratedFilename(
      "other-deck-export",
      ".pptx",
      "deck-2",
    );
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() });
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({ error: "Not found" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404);
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects legacy filenames that cannot be bound to a deck", async () => {
    mocks.filename = "legacy-export.pptx";
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({ error: "Not found" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 404);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("regenerates a bound filename when its cached deck marker is missing", async () => {
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() });
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response).toBeInstanceOf(Response);
    expect(mocks.run).toHaveBeenCalledWith(
      { deckId: "deck-1", includeNotes: false },
      {
        caller: "http",
        userEmail: "user@example.com",
        orgId: "org-1",
        slidesPptxDownload: true,
        slidesPptxDownloadFilename: mocks.filename,
        slidesPptxDownloadPersist: true,
        slidesPptxDownloadExpectedRevision: exportRevision,
      },
    );
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("regenerates instead of streaming a cache marked for another export revision", async () => {
    mocks.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() });
    mocks.readFile.mockResolvedValue("other-export-revision");
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response).toBeInstanceOf(Response);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(
      { deckId: "deck-1", includeNotes: false },
      expect.objectContaining({
        slidesPptxDownloadFilename: mocks.filename,
        slidesPptxDownloadExpectedRevision: exportRevision,
      }),
    );
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("does not expose the cached deck marker as a download", async () => {
    mocks.filename = `${mocks.filename}${PPTX_DECK_BINDING_FILE_SUFFIX}`;
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({ error: "Invalid filename" });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400);
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("does not regenerate when the cached export cannot be inspected", async () => {
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<unknown>;

    const event = {};
    const response = await handler(event);

    expect(response).toEqual({ error: "Could not read cached export." });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 500);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });
});
