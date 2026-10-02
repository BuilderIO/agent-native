import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { AppShellSkeleton } from "@agent-native/toolkit/app/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import messages from "@/i18n/en-US";

const SEO_TITLE = messages.routeTitles.formsIndex;
const SEO_DESCRIPTION = messages.routeDescriptions.formsIndex;

function target(url: URL): string {
  return `/ask${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

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

export function HydrateFallback() {
  return <AppShellSkeleton layout="assistant" />;
}

export default function HomeRoute() {
  return null;
}
