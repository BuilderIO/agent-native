import { DefaultSpinner } from "@agent-native/core/client/ui";
import { redirect, type LoaderFunctionArgs } from "react-router";

const SEO_TITLE = "Clips - Open Source screen recorder";
const SEO_DESCRIPTION =
  "Open Source screen recorder and meeting-notes app with AI transcripts, summaries, search, dictation, and agent-readable share links.";
const SSR_REDIRECT_HEADERS = {
  // The deploy adapter uses the HTML content type to apply Clips' public SSR
  // cache policy. Without it, the root redirect reaches origin on every visit
  // even though the /library shell is already cached at the edge.
  "content-type": "text/html; charset=utf-8",
};

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
  throw redirect(buildTarget(url), { headers: SSR_REDIRECT_HEADERS });
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(buildTarget(url), { headers: SSR_REDIRECT_HEADERS });
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
