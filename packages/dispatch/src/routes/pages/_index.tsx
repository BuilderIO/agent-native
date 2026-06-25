import { appPath } from "@agent-native/core/client";
import { redirect, type LoaderFunctionArgs } from "react-router";

import { Spinner } from "@/components/ui/spinner";

const SEO_TITLE =
  "Agent-Native Dispatch - Open Source workspace control plane for AI agents";
const SEO_DESCRIPTION =
  "Open Source workspace control plane for AI agents to manage apps, secrets, approvals, messages, jobs, and cross-app delegation.";

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

/**
 * Run the redirect on both the server and the client. A client-only
 * `<Navigate>` can drop during hydration (before the route tree is fully
 * attached), leaving the user stranded on `/` with a blank main area while
 * the layout chrome around it still renders. A `loader` redirect runs as
 * part of the server response and the navigation completes before the app
 * hydrates; `clientLoader` covers SPA-style navigations to `/`.
 *
 * We preserve `?` and `#` so deep-links like `?thread=<id>` from a Slack
 * "Open thread" button survive the bounce — `useThreadDeepLink` in
 * `root.tsx` reads them after the redirect lands and opens `/chat`.
 */
function buildTarget(url: URL): string {
  return appPath(`/overview${url.search}${url.hash}`);
}

export function loader({ url }: LoaderFunctionArgs) {
  throw redirect(buildTarget(url));
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(buildTarget(url));
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8" />
    </div>
  );
}

export default function IndexPage() {
  return null;
}
