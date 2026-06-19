import Index from "@/pages/Index";

const SEO_TITLE =
  "Agent-Native Analytics - Open source, agent-friendly Amplitude alternative";
const SEO_DESCRIPTION =
  "Connect analytics, warehouse, and CRM data so AI agents can query metrics, build dashboards, and answer business questions.";

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
