import { FormsListPage } from "@/pages/FormsListPage";

export function meta() {
  return [
    { title: "Agent-Native Forms" },
    {
      name: "description",
      content:
        "Your AI agent builds, publishes, and analyzes forms alongside you.",
    },
  ];
}

export default function FormsRoute() {
  return <FormsListPage />;
}
