import { appPath } from "@agent-native/core/client/api-path";
import { DefaultSpinner } from "@agent-native/core/client/ui";
import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

const SEO_TITLE =
  "Dispatch - Open Source workspace control plane for AI agents";
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

function buildTarget(url: URL): string {
  return appPath(`/overview${url.search}${url.hash}`);
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
  return <DefaultSpinner />;
}

export default function IndexPage() {
  return null;
}
