import { DefaultSpinner } from "@agent-native/core/client/ui";
import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

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
    <div className="flex items-center justify-center h-screen w-full">
      <DefaultSpinner />
    </div>
  );
}

export default function HomeRoute() {
  return null;
}
