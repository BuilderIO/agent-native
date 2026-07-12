import { DefaultSpinner } from "@agent-native/core/client";
import { redirect, type LoaderFunctionArgs } from "react-router";

const SEO_TITLE =
  "Agent-Native Clips - Open Source, agent-friendly Loom alternative";
const SEO_DESCRIPTION =
  "Open Source screen recorder and meeting-notes app with AI transcripts, summaries, search, dictation, and agent-readable share links.";

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
 * The root route redirects to /library — the Library is the default landing
 * view. Everything else hangs off the pathless _app layout so the sidebar +
 * agent chat persist across navigations.
 *
 * Run the redirect on both the server and the client. A client-only
 * `useNavigate(...)` inside `useEffect` can drop during hydration (before
 * the route tree is fully attached), leaving the user stranded on `/` with
 * a blank main area while the layout chrome around it still renders. A
 * `loader` redirect runs as part of the server response and the navigation
 * completes before the app hydrates; `clientLoader` covers SPA-style
 * navigations to `/`.
 */
function buildTarget(url: URL): string {
  return `/library${url.search}${url.hash}`;
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
      <DefaultSpinner />
    </div>
  );
}

export default function IndexPage() {
  return null;
}
