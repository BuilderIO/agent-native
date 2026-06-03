export { default } from "@agent-native/dispatch/routes/pages/chat";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildThreadLinkPreviewMeta,
  type ThreadLinkPreview,
} from "@agent-native/dispatch/lib/thread-link-preview";

export async function loader({ request }: LoaderFunctionArgs) {
  const threadId = new URL(request.url).searchParams.get("thread");
  const { loadThreadLinkPreview } =
    await import("@agent-native/dispatch/server/lib/thread-link-preview");
  return {
    threadPreview: await loadThreadLinkPreview(threadId),
  };
}

export function meta({
  data,
}: {
  data?: { threadPreview: ThreadLinkPreview | null };
}) {
  return data?.threadPreview
    ? buildThreadLinkPreviewMeta(data.threadPreview)
    : [{ title: "Chat — Dispatch" }];
}
