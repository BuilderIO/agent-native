import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "@agent-native/core/server";

const getRequestContextMock = vi.hoisted(() => vi.fn());
const getThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: getRequestContextMock,
  getThread: getThreadMock,
}));

import {
  extractThreadPreviewImageUrl,
  loadThreadLinkPreview,
} from "./thread-link-preview";

function threadDataWithResult(toolName: string, result: unknown) {
  return JSON.stringify({
    messages: [
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName,
              result:
                typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
        },
        parentId: null,
      },
    ],
  });
}

function previewThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-1",
    ownerEmail: "owner@example.test",
    title: "Launch image",
    preview: "Generated a launch image",
    threadData: threadDataWithResult("generate-image", {
      previewUrl: "https://cdn.example.com/generated-social.webp",
    }),
    messageCount: 1,
    createdAt: 1,
    updatedAt: 2,
    scope: null,
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  getRequestContextMock.mockReset();
  getThreadMock.mockReset();
});

describe("thread link preview image extraction", () => {
  it("uses generated image preview URLs from generate-image results", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image", {
          url: "https://app.example.com/assets/asset/asset-1",
          previewUrl: "https://cdn.example.com/generated-social.webp",
          thumbnailUrl: "https://cdn.example.com/generated-social-thumb.webp",
        }),
      ),
    ).toBe("https://cdn.example.com/generated-social.webp");
  });

  it("uses the newest image from batched generation results", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image-batch", {
          images: [
            { previewUrl: "https://cdn.example.com/first.png" },
            { previewUrl: "https://cdn.example.com/latest.png" },
          ],
        }),
      ),
    ).toBe("https://cdn.example.com/latest.png");
  });

  it("ignores asset page URLs that are not image media", () => {
    expect(
      extractThreadPreviewImageUrl(
        threadDataWithResult("generate-image", {
          url: "https://app.example.com/assets/asset/asset-1",
        }),
      ),
    ).toBeNull();
  });
});

describe("thread link preview access", () => {
  it("loads preview metadata for the owning user", async () => {
    getRequestContextMock.mockReturnValue({
      userEmail: "owner@example.test",
    });
    getThreadMock.mockResolvedValue(previewThread());

    await expect(loadThreadLinkPreview(" thread-1 ")).resolves.toEqual({
      title: "Launch image",
      description: "Generated a launch image",
      imageUrl: "https://cdn.example.com/generated-social.webp",
    });
    expect(getThreadMock).toHaveBeenCalledWith("thread-1");
  });

  it("does not read thread metadata without an authenticated request context", async () => {
    getRequestContextMock.mockReturnValue(undefined);

    await expect(loadThreadLinkPreview("thread-1")).resolves.toBeNull();
    expect(getThreadMock).not.toHaveBeenCalled();
  });

  it("does not emit another user's thread metadata", async () => {
    getRequestContextMock.mockReturnValue({
      userEmail: "viewer@example.test",
    });
    getThreadMock.mockResolvedValue(previewThread());

    await expect(loadThreadLinkPreview("thread-1")).resolves.toBeNull();
  });
});
