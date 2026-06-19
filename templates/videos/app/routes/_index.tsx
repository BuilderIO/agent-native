import Studio from "@/pages/Index";

const SEO_TITLE =
  "Agent-Native Videos - Open Source AI video editor for programmatic video";
const SEO_DESCRIPTION =
  "Build, animate, edit, and render programmatic videos with an AI video editor powered by React and Remotion.";

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
  return <Studio />;
}
