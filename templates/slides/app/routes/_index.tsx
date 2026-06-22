import Index from "@/pages/Index";

const SEO_TITLE =
  "Agent-Native Slides - Open Source AI presentation builder and Google Slides alternative";
const SEO_DESCRIPTION =
  "Open Source AI presentation builder for generating, editing, refining, and exporting React decks as Google Slides-ready presentations.";

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
