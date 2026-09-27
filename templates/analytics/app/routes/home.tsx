import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

const SEO_TITLE =
  "Analytics - Open Source Alternative to Amplitude & FullStory";
const SEO_DESCRIPTION =
  "Open Source analytics app and alternative to Amplitude and FullStory where AI agents connect to warehouses, product analytics, and CRM data to answer questions and build dashboards.";

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

function target(url: URL): string {
  return `/ask${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw withSsrHtmlContentType(redirect(target(url)), { varyByQuery: true });
}

export default function IndexRoute() {
  return null;
}
