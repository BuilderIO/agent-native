import Index from "@/pages/Index";

export function meta() {
  return [
    { title: "Agent-Native Analytics" },
    {
      name: "description",
      content:
        "Your AI agent queries your data sources, builds dashboards, and answers business questions alongside you.",
    },
  ];
}

export default function IndexRoute() {
  return <Index />;
}
