export { default } from "../pages/Index";

const SEO_TITLE =
  "Agent-Native Design - Open Source AI design tool for agent-built prototypes";
const SEO_DESCRIPTION =
  "Create, remix, and hand off interactive responsive designs with an AI design agent.";

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
