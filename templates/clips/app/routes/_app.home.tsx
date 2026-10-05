import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

const SEO_TITLE = "Clips - Open Source screen recorder";
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

function buildTarget(url: URL): string {
  return `/library${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(buildTarget(url)), {
    varyByQuery: true,
  });
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(buildTarget(url)), {
    varyByQuery: true,
  });
}

export function HydrateFallback() {
  return (
    <div aria-busy="true" className="space-y-5 p-6">
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-64 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-video w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function HomeRoute() {
  return null;
}
