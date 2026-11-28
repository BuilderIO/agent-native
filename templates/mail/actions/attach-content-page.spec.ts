import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  ownerEmail: "owner@example.com" as string | null,
  orgId: "org-1" as string | undefined,
}));
const readContentPageFile = vi.hoisted(() => vi.fn());
const storeMediaUpload = vi.hoisted(() => vi.fn());
const attachmentFromUpload = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => auth.orgId,
  getRequestUserEmail: () => auth.ownerEmail,
}));

vi.mock("../server/lib/content-page-files.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/content-page-files.js")
  >()),
  readContentPageFile,
}));

vi.mock("../server/lib/media-upload.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/media-upload.js")>()),
  storeMediaUpload,
  attachmentFromUpload,
}));

describe("attach-content-page", () => {
  beforeEach(() => {
    auth.ownerEmail = "owner@example.com";
    auth.orgId = "org-1";
    readContentPageFile.mockReset().mockResolvedValue({
      id: "tracker-page",
      title: "Launch tracker",
      kind: "collection",
      format: "csv",
      filename: "Launch tracker.csv",
      encoding: "utf8",
      content: "Title,Status\r\nSignup page,Ready\r\n",
      size: 33,
      data: Buffer.from("Title,Status\r\nSignup page,Ready\r\n"),
    });
    storeMediaUpload
      .mockReset()
      .mockImplementation(
        async (input: { filename: string; originalName: string }) => ({
          url: `/api/media/${input.filename}`,
          filename: input.filename,
          originalName: input.originalName,
          mimeType: "text/csv",
          size: 33,
        }),
      );
    attachmentFromUpload
      .mockReset()
      .mockImplementation(
        async (
          _owner: string,
          handle: { filename: string; originalName: string },
        ) => ({
          id: handle.filename,
          filename: handle.filename,
          originalName: handle.originalName,
          mimeType: "text/csv",
          size: 33,
        }),
      );
  });

  it("stores the page's file as the owner's upload and returns the draft attachment", async () => {
    const action = (await import("./attach-content-page.js")).default;

    const result = await action.run({ id: "tracker-page", format: "csv" });

    expect(readContentPageFile).toHaveBeenCalledWith({
      id: "tracker-page",
      format: "csv",
    });
    const stored = storeMediaUpload.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      originalName: "Launch tracker.csv",
      filename: expect.stringMatching(/^[\w-]{12}\.csv$/),
    });
    expect(new TextDecoder().decode(stored.data)).toBe(
      "Title,Status\r\nSignup page,Ready\r\n",
    );
    expect(result).toMatchObject({
      attachment: {
        id: stored.filename,
        filename: stored.filename,
        originalName: "Launch tracker.csv",
        mimeType: "text/csv",
      },
      page: { id: "tracker-page", kind: "collection", format: "csv" },
    });
  });

  it("asks Content for the PDF in the font picked and stores its bytes as they came", async () => {
    const pdf = Buffer.from("%PDF-1.3\n%\xff\xfe\n", "latin1");
    readContentPageFile.mockResolvedValue({
      id: "poems-page",
      title: "Poems",
      kind: "page",
      format: "pdf",
      filename: "Poems.pdf",
      encoding: "base64",
      content: pdf.toString("base64"),
      size: pdf.byteLength,
      data: pdf,
    });
    const action = (await import("./attach-content-page.js")).default;

    await action.run({ id: "poems-page", format: "pdf", font: "serif" });

    expect(readContentPageFile).toHaveBeenCalledWith({
      id: "poems-page",
      format: "pdf",
      font: "serif",
    });
    const stored = storeMediaUpload.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      originalName: "Poems.pdf",
      filename: expect.stringMatching(/^[\w-]{12}\.pdf$/),
    });
    expect(Buffer.from(stored.data).equals(pdf)).toBe(true);
  });

  it("says storage needs setting up when Mail can't store the file", async () => {
    const { MediaStorageSetupError } =
      await import("../server/lib/media-upload.js");
    storeMediaUpload.mockRejectedValue(
      new MediaStorageSetupError(
        "not-configured",
        "File storage isn't set up.",
      ),
    );
    const action = (await import("./attach-content-page.js")).default;

    await expect(action.run({ id: "tracker-page" })).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "storage_setup_required",
      details: { storageSetupReason: "not-configured" },
    });
  });

  it("requires a signed-in owner", async () => {
    auth.ownerEmail = null;
    const action = (await import("./attach-content-page.js")).default;

    await expect(action.run({ id: "tracker-page" })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(readContentPageFile).not.toHaveBeenCalled();
  });
});
