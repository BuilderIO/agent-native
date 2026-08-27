import { agentNativePath } from "@agent-native/core/client/api-path";
import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import { Spinner } from "@/components/ui/spinner";

const SEO_TITLE =
  "Mail - Open Source AI email client and Superhuman alternative";
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
 * hydrates. The server redirect stays preference-free for the public SSR
 * shell; client navigations can choose the saved preference, and InboxPage
 * applies the same first-use default after settings load.
 */
type MailPreferences = {
  pinnedLabels?: string[];
};

async function resolveRootInboxHref(): Promise<string> {
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/actions/get-mail-preferences"),
    );
    if (!response.ok) return "/inbox?label=important";
    const settings = (await response.json()) as MailPreferences;
    return settings.pinnedLabels === undefined
      ? "/inbox?label=important"
      : "/inbox";
  } catch {
    return "/inbox?label=important";
  }
}

export function loader(_args: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect("/inbox"));
}

export async function clientLoader(_args: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(await resolveRootInboxHref()));
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full">
      <Spinner className="size-8" />
    </div>
  );
}

export default function IndexRoute() {
  // Should never render — both loaders redirect to the inbox.
  return null;
}
