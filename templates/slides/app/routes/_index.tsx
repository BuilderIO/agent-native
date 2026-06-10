import Index from "@/pages/Index";

export function meta() {
  return [
    { title: "Agent-Native Slides" },
    {
      name: "description",
      content:
        "Your AI agent builds, edits, and refines presentations alongside you.",
    },
  ];
}

export default function IndexRoute() {
  return <Index />;
}
