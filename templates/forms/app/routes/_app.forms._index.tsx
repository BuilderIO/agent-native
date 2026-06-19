import { FormsListPage } from "@/pages/FormsListPage";

export function meta() {
  return [
    { title: "Agent-Native Forms - AI form builder and response analytics" },
    {
      name: "description",
      content: "View and manage forms built with Agent-Native Forms.",
    },
  ];
}

export default function FormsRoute() {
  return <FormsListPage />;
}
