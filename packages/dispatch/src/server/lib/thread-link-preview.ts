import type { ChatThread } from "@agent-native/core/server";

import {
  extractThreadPreviewImageUrl,
  type ThreadLinkPreview,
} from "../../lib/thread-link-preview";

function previewDescription(thread: ChatThread): string {
  const preview = thread.preview.trim();
  if (preview) return preview.slice(0, 180);
  return "Open this Agent-Native thread in Dispatch.";
}

export async function loadThreadLinkPreview(
  threadId: string | null | undefined,
): Promise<ThreadLinkPreview | null> {
  const id = threadId?.trim();
  if (!id) return null;
  const { getRequestContext, getThread } =
    await import("@agent-native/core/server");
  const viewerEmail = getRequestContext()?.userEmail?.trim();
  if (!viewerEmail) return null;
  const thread = await getThread(id).catch(() => null);
  if (!thread) return null;
  if (thread.ownerEmail !== viewerEmail) return null;
  const title = thread.title.trim() || "Agent-Native thread";
  return {
    title,
    description: previewDescription(thread),
    imageUrl: extractThreadPreviewImageUrl(thread.threadData),
  };
}
