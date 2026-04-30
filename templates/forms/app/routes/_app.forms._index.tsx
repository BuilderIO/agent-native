import { FormsListPage } from "@/pages/FormsListPage";

export function meta() {
  return [
    { title: "Forms" },
    {
      name: "description",
      content:
        "Agent-native form builder — describe what you want and the agent assembles fields, branding, and a public URL ready to share.",
    },
  ];
}

export default function FormsRoute() {
  return <FormsListPage />;
}
