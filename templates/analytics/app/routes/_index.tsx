import { redirect, type LoaderFunctionArgs } from "react-router";

const SEO_TITLE =
  "Agent-Native Analytics - Open Source, agent-friendly Amplitude alternative";
const SEO_DESCRIPTION =
  "Open Source analytics app where AI agents connect to warehouses, product analytics, and CRM data to answer questions and build dashboards.";

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
  throw redirect(target(url));
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export default function IndexRoute() {
  return null;
}
