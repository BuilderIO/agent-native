import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  isTextLikeMimeType,
  isTextLikeFilename,
  persistTextAttachmentsAsResources,
  createCoreAttachmentActionEntries,
} from "./attachment-actions.js";

describe("isTextLikeMimeType", () => {
  it("recognises plain text variants", () => {
    expect(isTextLikeMimeType("text/plain")).toBe(true);
    expect(isTextLikeMimeType("text/csv")).toBe(true);
    expect(isTextLikeMimeType("text/markdown")).toBe(true);
    expect(isTextLikeMimeType("text/html")).toBe(true);
  });

  it("recognises code / data MIME types", () => {
    expect(isTextLikeMimeType("application/json")).toBe(true);
    expect(isTextLikeMimeType("application/javascript")).toBe(true);
    expect(isTextLikeMimeType("application/typescript")).toBe(true);
    expect(isTextLikeMimeType("application/x-yaml")).toBe(true);
    expect(isTextLikeMimeType("message/rfc822")).toBe(true);
  });

  it("rejects binary types", () => {
    expect(isTextLikeMimeType("application/pdf")).toBe(false);
    expect(isTextLikeMimeType("image/png")).toBe(false);
    expect(isTextLikeMimeType("video/mp4")).toBe(false);
    expect(isTextLikeMimeType(undefined)).toBe(false);
  });
});

describe("isTextLikeFilename", () => {
  it("recognises common text extensions", () => {
    expect(isTextLikeFilename("notes.txt")).toBe(true);
    expect(isTextLikeFilename("data.csv")).toBe(true);
    expect(isTextLikeFilename("config.yaml")).toBe(true);
    expect(isTextLikeFilename("README.md")).toBe(true);
    expect(isTextLikeFilename("index.ts")).toBe(true);
    expect(isTextLikeFilename("query.sql")).toBe(true);
    expect(isTextLikeFilename("schema.graphql")).toBe(true);
    expect(isTextLikeFilename("message.eml")).toBe(true);
  });

  it("rejects binary filenames", () => {
    expect(isTextLikeFilename("image.png")).toBe(false);
    expect(isTextLikeFilename("document.pdf")).toBe(false);
    expect(isTextLikeFilename(undefined)).toBe(false);
  });
});

const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourceGetMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourcePut: resourcePutMock,
  resourceList: resourceListMock,
  resourceGet: resourceGetMock,
}));

describe("persistTextAttachmentsAsResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourcePutMock.mockImplementation(
      async (owner: string, path: string, content: string) => ({
        id: `resource-${path.replace(/\//g, "-")}`,
        path,
        owner,
        content,
        mimeType: "text/plain",
        size: content.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: "user",
        visibility: "agent_scratch",
        threadId: "thread-1",
        runId: null,
        expiresAt: null,
        metadata: null,
      }),
    );
  });

  it("stores text attachments and returns index→resource map", async () => {
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "data.csv",
          contentType: "text/csv",
          text: "id,name\n1,Alice",
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.size).toBe(1);
    expect(result.get(0)).toMatchObject({
      kind: "stored",
      path: "attachments/thread-1/0-data.csv",
      totalChars: "id,name\n1,Alice".length,
    });
    expect(resourcePutMock).toHaveBeenCalledOnce();
    const [owner, path, content] = resourcePutMock.mock.calls[0];
    expect(owner).toBe("user@example.com");
    expect(path).toBe("attachments/thread-1/0-data.csv");
    expect(content).toBe("id,name\n1,Alice");
  });

  it("keeps the tail of a large EML available for read-attachment", async () => {
    const content =
      "From: sender@example.com\n\n" + "A".repeat(200_000) + "TAIL";

    const stored = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "message.eml",
          contentType: "message/rfc822",
          text: content,
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(stored.get(0)).toMatchObject({
      kind: "stored",
      totalChars: content.length,
    });
    resourceListMock.mockResolvedValue([
      { id: "resource-message", path: "attachments/thread-1/0-message.eml" },
    ]);
    resourceGetMock.mockResolvedValue({ content });

    const result = await createCoreAttachmentActionEntries()[
      "read-attachment"
    ].run(
      {
        name: "message.eml",
        threadId: "thread-1",
        offset: String(content.length - 4),
        limit: "4",
      },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.content).toBe("TAIL");
    expect(result.totalChars).toBe(content.length);
  });

  it("skips attachments without text content", async () => {
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        { type: "image", name: "photo.png", contentType: "image/png" },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.size).toBe(0);
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("skips non-text-like attachments even when they have a text field", async () => {
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "doc.pdf",
          contentType: "application/pdf",
          text: "some extracted text",
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.size).toBe(0);
  });

  it("uses filename detection as fallback when contentType is absent", async () => {
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "script.py",
          text: 'print("hello")',
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.get(0)).toMatchObject({
      kind: "stored",
      path: "attachments/thread-1/0-script.py",
    });
  });

  it("reports a failed write as a typed failure instead of a missing entry", async () => {
    resourcePutMock.mockRejectedValue(new Error("DB unavailable"));

    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          contentType: "text/plain",
          text: "hello",
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.get(0)).toEqual({
      kind: "failed",
      reason: "write-failed",
      error: "DB unavailable",
    });
  });

  it("stores hydrated markdown and SVG data URLs as text", async () => {
    const markdown = "# Design\n" + "x".repeat(70_000);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "DESIGN.md",
          contentType: "text/markdown",
          data: `data:text/markdown;base64,${Buffer.from(markdown).toString("base64")}`,
        },
        {
          type: "file",
          name: "logo.svg",
          contentType: "image/svg+xml",
          data: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.get(0)).toMatchObject({
      kind: "stored",
      totalChars: markdown.length,
    });
    expect(result.get(1)).toMatchObject({ kind: "stored" });
    expect(
      resourcePutMock.mock.calls.map((call) => [call[2], call[3]]),
    ).toEqual([
      [markdown, "text/markdown"],
      [svg, "text/plain"],
    ]);
  });

  it("does not store display-only attachments the prompt leaves out", async () => {
    const result = await persistTextAttachmentsAsResources({
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          contentType: "text/plain",
          displayOnly: true,
          text: "not for the model",
        },
      ],
      threadId: "thread-1",
      ownerEmail: "user@example.com",
    });

    expect(result.size).toBe(0);
    expect(resourcePutMock).not.toHaveBeenCalled();
  });
});

describe("createCoreAttachmentActionEntries / read-attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeResource = (content: string) => ({
    id: "res-1",
    path: "attachments/thread-1/0-data.csv",
    owner: "user@example.com",
    content,
    mimeType: "text/csv",
    size: content.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: "user",
    visibility: "agent_scratch",
    threadId: "thread-1",
    runId: null,
    expiresAt: null,
    metadata: null,
  });

  it("returns first slice and hasMore=true when content exceeds limit", async () => {
    const bigContent = "x".repeat(20_000);
    resourceListMock.mockResolvedValue([
      {
        id: "res-1",
        path: "attachments/thread-1/0-data.csv",
        owner: "user@example.com",
      },
    ]);
    resourceGetMock.mockResolvedValue(makeResource(bigContent));

    const entries = createCoreAttachmentActionEntries();
    const result = await entries["read-attachment"].run(
      { name: "data.csv", threadId: "thread-1", offset: "0", limit: "8000" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.content).toHaveLength(8000);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
    expect(result.totalChars).toBe(20_000);
  });

  it("returns second page correctly", async () => {
    const content = "A".repeat(5000) + "B".repeat(5000);
    resourceListMock.mockResolvedValue([
      { id: "res-1", path: "attachments/thread-1/0-data.csv" },
    ]);
    resourceGetMock.mockResolvedValue(makeResource(content));

    const entries = createCoreAttachmentActionEntries();
    const result = await entries["read-attachment"].run(
      { name: "data.csv", threadId: "thread-1", offset: "5000", limit: "5000" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.content).toBe("B".repeat(5000));
    expect(result.hasMore).toBe(false);
  });

  it("reads by stored path when names collide or need escaping", async () => {
    resourceListMock.mockResolvedValue([
      { id: "res-0", path: "attachments/thread-1/0-Q_A.md" },
      { id: "res-1", path: "attachments/thread-1/1-Q_A.md" },
    ]);
    resourceGetMock.mockImplementation(async (id: string) =>
      makeResource(id === "res-1" ? "second" : "first"),
    );

    const result = await createCoreAttachmentActionEntries()[
      "read-attachment"
    ].run(
      { path: "attachments/thread-1/1-Q_A.md" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(resourceListMock).toHaveBeenCalledWith(
      "user@example.com",
      "attachments/thread-1/",
      { includeAgentScratch: true },
    );
    expect(result.content).toBe("second");
  });

  it("rejects a path outside stored attachments", async () => {
    const result = await createCoreAttachmentActionEntries()[
      "read-attachment"
    ].run(
      { path: "notes/private.md" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.error).toContain("is not a stored attachment path");
    expect(resourceListMock).not.toHaveBeenCalled();
  });

  it("returns error when attachment is not found", async () => {
    resourceListMock.mockResolvedValue([]);

    const entries = createCoreAttachmentActionEntries();
    const result = await entries["read-attachment"].run(
      { name: "missing.csv", threadId: "thread-1" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.error).toContain("missing.csv");
  });

  it("returns error when name is missing", async () => {
    const entries = createCoreAttachmentActionEntries();
    const result = await entries["read-attachment"].run(
      { threadId: "thread-1" },
      { caller: "tool", userEmail: "user@example.com" },
    );

    expect(result.error).toContain("name or path is required");
  });
});
