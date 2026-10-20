import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  toBuffer: vi.fn(),
  toString: vi.fn(),
  uuids: ["file-uuid", "history-uuid"],
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => mocks.uuids.shift() };
});
vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details: unknown) => {
    throw Object.assign(new Error(message), { details });
  },
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
}));
vi.mock("qrcode", () => ({
  default: { toBuffer: mocks.toBuffer, toString: mocks.toString },
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ insert: mocks.insert }),
  schema: { qrHistory: { id: "id" } },
}));

import generateQrCode from "./generate-qr-code.js";

const args = {
  content: "https://example.com/share",
  format: "png" as const,
  size: 384,
  margin: 3,
  fgColor: "#123456",
  bgColor: "#abcdef",
};

describe("generate-qr-code", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.uuids = ["file-uuid", "history-uuid"];
    mocks.toBuffer.mockResolvedValue(Buffer.from([137, 80, 78, 71]));
    mocks.toString.mockResolvedValue("<svg></svg>");
    mocks.uploadFile.mockResolvedValue({ url: "https://files.example/qr.png" });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockResolvedValue(undefined);
  });

  it("uploads PNG bytes with requested metadata and a random filename", async () => {
    const result = await generateQrCode.run(args, {
      userEmail: "user@example.com",
    } as never);

    expect(mocks.toBuffer).toHaveBeenCalledWith(args.content, {
      width: 384,
      margin: 3,
      color: { dark: "#123456", light: "#abcdef" },
      errorCorrectionLevel: "H",
    });
    expect(mocks.uploadFile).toHaveBeenCalledWith({
      data: Buffer.from([137, 80, 78, 71]),
      filename: "file-uuid.png",
      mimeType: "image/png",
      ownerEmail: "user@example.com",
      recordAsset: false,
    });
    expect(mocks.uploadFile.mock.calls[0][0].filename).not.toContain(
      args.content,
    );
    expect(result).toMatchObject({
      url: "https://files.example/qr.png",
      format: "png",
      mimeType: "image/png",
      size: 384,
      margin: 3,
      fgColor: "#123456",
      bgColor: "#abcdef",
      byteSize: 4,
      content: args.content,
      historySaved: true,
    });
  });

  it("supports SVG and does not save history for an organization principal", async () => {
    const result = await generateQrCode.run({ ...args, format: "svg" }, {
      organizationId: "org-1",
    } as never);

    expect(mocks.uploadFile).toHaveBeenCalledWith({
      data: Buffer.from("<svg></svg>"),
      filename: "file-uuid.svg",
      mimeType: "image/svg+xml",
      recordAsset: false,
    });
    expect(result).toMatchObject({
      format: "svg",
      mimeType: "image/svg+xml",
      byteSize: 11,
      historySaved: false,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("saves history under the authenticated email", async () => {
    await generateQrCode.run(args, {
      userEmail: " person@example.com ",
    } as never);

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "history-uuid",
        ownerEmail: "person@example.com",
        content: args.content,
        format: "png",
        size: 384,
        margin: 3,
      }),
    );
  });

  it("returns a typed failure when file storage is unavailable", async () => {
    mocks.uploadFile.mockResolvedValue(null);

    await expect(generateQrCode.run(args, {} as never)).rejects.toMatchObject({
      details: { errorCode: "file_storage_unavailable", statusCode: 503 },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
