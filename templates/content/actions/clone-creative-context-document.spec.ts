import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPrivateBlob: vi.fn(),
  resolveReference: vi.fn(),
  createDocument: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("@agent-native/creative-context/server", () => ({
  resolveNativeContextCloneReference: mocks.resolveReference,
}));
vi.mock("./create-document.js", () => ({
  default: { run: mocks.createDocument },
}));

import action from "./clone-creative-context-document.js";

describe("clone-creative-context-document", () => {
  const content = "# Exact document\n\nApproved copy.";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReference.mockResolvedValue({
      publishedItemVersionId: "version-1",
      cloneHandle: { key: "private" },
    });
    mocks.readPrivateBlob.mockResolvedValue({
      data: Buffer.from(content),
      metadata: {
        appId: "content",
        resourceType: "document",
        resourceId: "doc-1",
        contentHash: createHash("sha256").update(content).digest("hex"),
      },
    });
    mocks.createDocument.mockResolvedValue({
      id: "doc-copy",
      title: "Context document",
      urlPath: "/documents/doc-copy",
    });
  });

  it("clones the exact approved Markdown through the owning document action", async () => {
    const result = await action.run({
      contextId: "context-1",
      artifactKey: "content:document:doc-1",
      resourceId: "doc-1",
    });
    expect(mocks.createDocument).toHaveBeenCalledWith({
      title: "Context document",
      content,
    });
    expect(result).toMatchObject({
      id: "doc-copy",
      clonedExactVersion: "version-1",
    });
    expect(result).not.toHaveProperty("cloneHandle");
  });
});
