import { FormsListPage } from "@/pages/FormsListPage";

export function meta() {
  const description =
    "Open Source AI form builder for creating, publishing, editing, and analyzing forms and responses from a chat-first workspace.";

  return [
    {
      title:
        "Agent-Native Forms - Open Source AI form builder and response analytics",
    },
    {
      name: "description",
      content: description,
    },
    { property: "og:description", content: description },
    { name: "twitter:description", content: description },
  ];
}

export default function FormsRoute() {
  return <FormsListPage />;
}
