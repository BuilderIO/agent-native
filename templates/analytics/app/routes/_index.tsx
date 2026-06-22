import Index from "@/pages/Index";

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

export default function IndexRoute() {
  return <Index />;
}
