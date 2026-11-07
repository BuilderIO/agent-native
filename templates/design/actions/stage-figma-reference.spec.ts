import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn((): string | undefined => "designer@example.com"),
  mint: vi.fn(async () => "attachment:v1:ref"),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));
vi.mock("../server/lib/figma-reference-attachment.js", () => ({
  mintFigmaReference: mocks.mint,
}));

import action from "./stage-figma-reference";

const gzip = (value: unknown) =>
  gzipSync(Buffer.from(JSON.stringify(value))).toString("base64");
const run = (payloadGzipBase64: string) =>
  action.run({ payloadGzipBase64 } as never, {} as never);
const payload = (frameCount: number) => ({
  frames: Array.from({ length: frameCount }, (_, index) => ({
    name: `Screen ${index + 1}`,
    html: "<main></main>",
  })),
  frameCount,
  unresolvedImages: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email.mockReturnValue("designer@example.com");
});

describe("stage-figma-reference", () => {
  it("stores the gzipped frames as the caller's attachment", async () => {
    await expect(run(gzip(payload(97)))).resolves.toEqual({
      ref: "attachment:v1:ref",
    });
    expect(mocks.mint).toHaveBeenCalledWith(
      payload(97),
      "designer@example.com",
    );
  });

  it("names a file with too many frames instead of calling it unreadable", async () => {
    await expect(run(gzip(payload(1001)))).rejects.toThrow(
      /1001 frames, more than the 1000/,
    );
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it("refuses a body that is not gzipped frames", async () => {
    await expect(run("bm90IGd6aXA=")).rejects.toThrow(/could not be read/);
    await expect(run(gzip({ frames: [] }))).rejects.toThrow(
      /could not be read/,
    );
    expect(mocks.mint).not.toHaveBeenCalled();
  });
});
