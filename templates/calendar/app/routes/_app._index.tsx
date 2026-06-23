import CalendarView from "@/pages/CalendarView";

const SEO_TITLE =
  "Agent-Native Calendar - Open Source AI scheduling and Google Calendar automation";
const SEO_DESCRIPTION =
  "Open Source AI calendar app for Google Calendar scheduling, booking links, meeting coordination, and agent-managed event updates.";

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
  return <CalendarView />;
}
