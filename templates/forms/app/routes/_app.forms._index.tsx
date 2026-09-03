import messages from "@/i18n/en-US";
import { FormsListPage } from "@/pages/FormsListPage";

export function meta() {
  const description = messages.routeDescriptions.formsIndex;

  return [
    {
      title: messages.routeTitles.formsIndex,
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
