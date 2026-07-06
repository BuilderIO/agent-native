import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { redirect } from "react-router";

const SEO_TITLE =
  "Agent-Native Mail - Open Source AI email client and Superhuman alternative";
const SEO_DESCRIPTION =
  "Open Source AI email client for Gmail triage, drafting, organization, follow-ups, and inbox workflows built around shared actions.";

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
 * Run the redirect on both the server and the client. Doing it client-only
 * via `clientLoader` previously caused React Router to occasionally log
 * `No routes matched location "/inbox"` because the navigation fired during
 * hydration, before the route tree was fully attached. A `loader` runs as
 * part of the server response and the navigation completes before the app
 * hydrates. The app opens to the Important triage tab by default.
 */
export function loader() {
  throw redirect("/inbox?label=important");
}

export function clientLoader() {
  throw redirect("/inbox?label=important");
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8" />
    </div>
  );
}

export default function IndexRoute() {
  // Should never render — both loaders redirect to the default triage tab.
  return null;
}
