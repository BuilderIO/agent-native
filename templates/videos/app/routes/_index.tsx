import Studio from "@/pages/Index";

export function meta() {
  return [
    { title: "Agent-Native Videos" },
    {
      name: "description",
      content:
        "Your AI agent builds, animates, and refines programmatic videos alongside you.",
    },
  ];
}

export default function IndexRoute() {
  return <Studio />;
}
