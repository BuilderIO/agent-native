export { default } from "@agent-native/dispatch/routes/pages/chat";
import {
  buildThreadLinkPreviewMeta,
  type ThreadLinkPreview,
} from "@agent-native/dispatch/lib/thread-link-preview";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ params, url }: LoaderFunctionArgs) {
  const threadId = params.threadId ?? url.searchParams.get("thread");
  const { loadThreadLinkPreview } =
    await import("@agent-native/dispatch/server/lib/thread-link-preview");
  return {
    threadPreview: await loadThreadLinkPreview(threadId),
  };
}

export function meta({
  loaderData,
}: {
  loaderData?: { threadPreview: ThreadLinkPreview | null };
}) {
  return loaderData?.threadPreview
    ? buildThreadLinkPreviewMeta(loaderData.threadPreview)
    : [{ title: "Chat — Dispatch" }];
}
