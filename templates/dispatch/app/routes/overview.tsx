export { default } from "@agent-native/dispatch/routes/pages/overview";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildThreadLinkPreviewMeta,
  type ThreadLinkPreview,
} from "@agent-native/dispatch/lib/thread-link-preview";

const SEO_TITLE =
  "Agent-Native Dispatch - Open Source workspace control plane for AI agents";
const SEO_DESCRIPTION =
  "Open Source workspace control plane for AI agents to manage apps, secrets, approvals, messages, jobs, and cross-app delegation.";

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
    : [
        { title: SEO_TITLE },
        { name: "description", content: SEO_DESCRIPTION },
        { property: "og:title", content: SEO_TITLE },
        { property: "og:description", content: SEO_DESCRIPTION },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: SEO_TITLE },
        { name: "twitter:description", content: SEO_DESCRIPTION },
      ];
}
