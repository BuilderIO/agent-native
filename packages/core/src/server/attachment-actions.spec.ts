import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isTextLikeMimeType,
  isTextLikeFilename,
  persistTextAttachmentsAsResources,
  createCoreAttachmentActionEntries,
} from "./attachment-actions.js";

// ---------------------------------------------------------------------------
// Helpers: mime / filename detection
// ---------------------------------------------------------------------------

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
  });

  it("rejects binary filenames", () => {
    expect(isTextLikeFilename("image.png")).toBe(false);
    expect(isTextLikeFilename("document.pdf")).toBe(false);
    expect(isTextLikeFilename(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// persistTextAttachmentsAsResources
// ---------------------------------------------------------------------------

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
      path: "attachments/thread-1/0-data.csv",
      totalChars: "id,name\n1,Alice".length,
    });
    expect(resourcePutMock).toHaveBeenCalledOnce();
    const [owner, path, content] = resourcePutMock.mock.calls[0];
    expect(owner).toBe("user@example.com");
    expect(path).toBe("attachments/thread-1/0-data.csv");
    expect(content).toBe("id,name\n1,Alice");
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

    expect(result.size).toBe(1);
    expect(result.get(0)?.path).toBe("attachments/thread-1/0-script.py");
  });

  it("does not throw when resourcePut fails — returns empty map entry", async () => {
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

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// read-attachment action slicing
// ---------------------------------------------------------------------------

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

    expect(result.error).toContain("name is required");
  });
});
