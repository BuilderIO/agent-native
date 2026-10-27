import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHubSpotEmailHtml } from "../shared/hubspot-email.js";
import { sourceContentHash } from "../shared/source-workspace.js";

const mocks = vi.hoisted(() => {
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return {
    query,
    select: vi.fn(() => query),
    resolveAccess: vi.fn(),
    exportEmail: vi.fn(),
  };
});
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: { designFiles: { designId: "designId", id: "id" } },
}));
vi.mock("../server/lib/hubspot-email-export.js", () => ({
  exportHubSpotEmailHtml: mocks.exportEmail,
}));
vi.mock("../server/lib/design-export.js", () => ({
  exportFilename: (title: string, extension: string) => `${title}.${extension}`,
}));

import exportAction from "./export-hubspot-html.js";

describe("export-hubspot-html access and snapshot boundary", () => {
  const content = createHubSpotEmailHtml().replace(
    '<meta name="agent-native:frame-type" content="hubspot-email">',
    "",
  );
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue({
      resource: { title: "Email design" },
      role: "viewer",
    });
    mocks.query.limit.mockResolvedValue([
      {
        id: "email-file",
        filename: "announcement.html",
        fileType: "html",
        content,
      },
    ]);
    mocks.exportEmail.mockResolvedValue({ html: "exported", imageCount: 0 });
  });

  it("denies inaccessible designs before reading child files or verifying image URLs", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    await expect(
      exportAction.run({ id: "private-design", fileId: "email-file" }),
    ).rejects.toThrow("inaccessible");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.exportEmail).not.toHaveBeenCalled();
  });

  it("rejects an absent or foreign child frame", async () => {
    mocks.query.limit.mockResolvedValue([]);
    await expect(
      exportAction.run({ id: "design", fileId: "foreign-file" }),
    ).rejects.toThrow("not found in this design");
    expect(mocks.exportEmail).not.toHaveBeenCalled();
  });

  it("rejects stale editor content before exporting the saved snapshot", async () => {
    await expect(
      exportAction.run({
        id: "design",
        fileId: "email-file",
        expectedVersionHash: sourceContentHash(content + "changed"),
      }),
    ).rejects.toThrow("unsaved or concurrent changes");
    expect(mocks.exportEmail).not.toHaveBeenCalled();
  });

  it("reads the unmarked HTML snapshot unchanged and returns a downloadable filename", async () => {
    const result = await exportAction.run({
      id: "design",
      fileId: "email-file",
      expectedVersionHash: sourceContentHash(content),
    });
    expect(mocks.exportEmail).toHaveBeenCalledWith(content);
    expect((await mocks.query.limit.mock.results[0].value)[0].content).toBe(
      content,
    );
    expect(result).toEqual({
      html: "exported",
      imageCount: 0,
      filename: "announcement-hubspot.html",
    });
  });

  it("checks a distinct original HTML frame before forwarding unchanged snapshots for link preservation", async () => {
    const original = '<a href="https://example.com/invite">Invite</a>';
    const sourceFile = {
      id: "original-file",
      fileType: "html",
      content: original,
    };
    mocks.query.limit
      .mockResolvedValueOnce([
        { id: "email-file", filename: "email.html", fileType: "html", content },
      ])
      .mockResolvedValueOnce([sourceFile]);
    await exportAction.run({
      id: "design",
      fileId: "email-file",
      preserveLinksFromFileId: "original-file",
    });
    expect(mocks.exportEmail).toHaveBeenCalledWith(content, {
      preserveLinksFromHtml: original,
    });
    expect(sourceFile.content).toBe(original);
  });

  it("rejects a trivial self-comparison before exporting", async () => {
    await expect(
      exportAction.run({
        id: "design",
        fileId: "email-file",
        preserveLinksFromFileId: "email-file",
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ errorCode: "invalid_hubspot_email" }),
    );
    expect(mocks.exportEmail).not.toHaveBeenCalled();
    expect(mocks.query.limit).toHaveBeenCalledTimes(1);
  });

  it.each(
    [
      [],
      [{ fileType: "css", content: "body{}" }],
      [{ fileType: "html", content: "" }],
    ].map((sourceRows) => [sourceRows]),
  )(
    "rejects missing, foreign or unreadable original HTML (%s)",
    async (sourceRows) => {
      mocks.query.limit
        .mockResolvedValueOnce([
          {
            id: "email-file",
            filename: "email.html",
            fileType: "html",
            content,
          },
        ])
        .mockResolvedValueOnce(sourceRows);
      await expect(
        exportAction.run({
          id: "design",
          fileId: "email-file",
          preserveLinksFromFileId: "missing-or-foreign",
        }),
      ).rejects.toThrow("original HTML content frame");
      expect(mocks.exportEmail).not.toHaveBeenCalled();
    },
  );
});
