import { DefaultSpinner } from "@agent-native/core/client";
import { redirect, type LoaderFunctionArgs } from "react-router";

import messages from "@/i18n/en-US";

const SEO_TITLE = messages.routeTitles.formsIndex;
const SEO_DESCRIPTION = messages.routeDescriptions.formsIndex;

function target(url: URL): string {
  return `/ask${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
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
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <DefaultSpinner />
    </div>
  );
}

export default function IndexRoute() {
  return null;
}
