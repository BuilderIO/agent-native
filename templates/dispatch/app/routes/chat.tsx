export { default } from "@agent-native/dispatch/routes/pages/chat";
import {
  buildThreadLinkPreviewMeta,
  type ThreadLinkPreview,
} from "@agent-native/dispatch/lib/thread-link-preview";
import type { LoaderFunctionArgs } from "react-router";

import { messagesByLocale } from "@/i18n-data";

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
    : [{ title: messagesByLocale["en-US"].routeTitles.chat }];
}
