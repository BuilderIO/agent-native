import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PPTX_DECK_BINDING_FILE_SUFFIX,
  pptxDeckBindingKey,
  safeGeneratedFilename,
} from "../../../lib/tenant-files.js";

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
    mocks.readFile.mockResolvedValue(pptxDeckBindingKey("deck-1"));
    mocks.query.mockReturnValue({ deckId: "deck-1", includeNotes: "false" });
    mocks.run.mockResolvedValue({
      buffer: Buffer.from("pptx-bytes"),
      filename: "deck-export.pptx",
    });
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "user@example.com", orgId: "org-1" },
    });
    mocks.resolveAccess.mockResolvedValue({ resource: { id: "deck-1" } });
  });

  it("regenerates a missing serverless export after checking the user session", async () => {
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
        slidesPptxDownload: true,
        slidesPptxDownloadFilename: mocks.filename,
        slidesPptxDownloadPersist: true,
      },
    );
  });

  it("reuses a persisted export after the first authenticated regeneration", async () => {
    mocks.stat
      .mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      )
      .mockResolvedValueOnce({ size: 12 });
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

  it("does not stream a cached export after deck access is revoked", async () => {
    mocks.stat.mockResolvedValue({ size: 12 });
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
    mocks.stat.mockResolvedValue({ size: 12 });
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

  it("regenerates legacy cached filenames instead of streaming unbound files", async () => {
    mocks.filename = "legacy-export.pptx";
    mocks.stat.mockResolvedValue({ size: 12 });
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response).toBeInstanceOf(Response);
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
        slidesPptxDownloadPersist: true,
      },
    );
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("regenerates a bound filename when its cached deck marker is missing", async () => {
    mocks.stat.mockResolvedValue({ size: 12 });
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
        slidesPptxDownloadPersist: true,
      },
    );
    expect(mocks.createReadStream).not.toHaveBeenCalled();
    expect(mocks.streamFile).not.toHaveBeenCalled();
  });

  it("regenerates instead of streaming a cache marked for another deck", async () => {
    mocks.stat.mockResolvedValue({ size: 12 });
    mocks.readFile.mockResolvedValue(pptxDeckBindingKey("deck-2"));
    const handler = (await import("./[filename].get.js")).default as (
      event: unknown,
    ) => Promise<Response>;

    const response = await handler({});

    expect(response).toBeInstanceOf(Response);
    expect(mocks.run).toHaveBeenCalledTimes(1);
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
