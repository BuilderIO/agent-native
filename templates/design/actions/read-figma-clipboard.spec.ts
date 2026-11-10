import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  mint: vi.fn(async () => "attachment:v1:staged"),
  email: vi.fn((): string | undefined => "member@example.test"),
}));
vi.mock("../server/lib/figma-clipboard-local-decode.js", () => ({
  importFigmaClipboardFromBuffer: mocks.decode,
}));
vi.mock("../server/lib/figma-reference-attachment.js", () => ({
  mintFigmaReference: mocks.mint,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));

import readFigmaClipboard from "./read-figma-clipboard";

const run = (args: Record<string, unknown>) =>
  readFigmaClipboard.run(
    { figmetaFileKey: "abcDEF123", clipboardHtml: "", ...args } as never,
    {} as never,
  );

beforeEach(() => {
  mocks.decode.mockReset();
  mocks.mint.mockClear();
  mocks.email.mockReturnValue("member@example.test");
});

describe("read-figma-clipboard", () => {
  it("decodes the clipboard scene into frames and saves nothing", async () => {
    mocks.decode.mockResolvedValue({
      files: [
        {
          filename: "Pricing.html",
          fileType: "html",
          content: "<main>Plans</main>",
          preferredFrame: { title: "Pricing", width: 1440, height: 900 },
        },
        { filename: "styles.css", fileType: "css", content: "body{}" },
      ],
      unresolvedImageRefs: ["hash"],
    });
    await expect(run({ clipboardBuffer: "ZmlnLWtpd2k=" })).resolves.toEqual({
      frames: [
        {
          name: "Pricing",
          width: 1440,
          height: 900,
          html: "<main>Plans</main>",
        },
      ],
      unresolvedImages: 1,
      ref: "attachment:v1:staged",
    });
    expect(mocks.mint).toHaveBeenCalledWith(
      {
        frames: [
          {
            name: "Pricing",
            width: 1440,
            height: 900,
            html: "<main>Plans</main>",
          },
        ],
        frameCount: 1,
        unresolvedImages: 1,
      },
      "member@example.test",
    );
    expect(mocks.decode).toHaveBeenCalledWith({
      bufferBase64: "ZmlnLWtpd2k=",
      fileKey: "abcDEF123",
    });
  });

  it("falls back to the clipboard's visible HTML without a buffer", async () => {
    const result = await run({
      clipboardHtml: "<div><p>Visible preview</p></div>",
    });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.name).toBeNull();
    expect(result.frames[0]?.html).toContain("Visible preview");
    expect(mocks.decode).not.toHaveBeenCalled();
  });

  it("refuses an empty clipboard, an oversized one, and a signed-out caller", async () => {
    await expect(run({ clipboardHtml: "" })).rejects.toThrow(
      /no copied Figma layers/,
    );
    await expect(
      run({ clipboardBufferOmittedBytes: 20 * 1024 * 1024 }),
    ).rejects.toThrow(/20 MB/);
    mocks.email.mockReturnValue(undefined);
    await expect(run({ clipboardBuffer: "ZmlnLWtpd2k=" })).rejects.toThrow(
      /Sign in/,
    );
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.mint).not.toHaveBeenCalled();
  });
});
