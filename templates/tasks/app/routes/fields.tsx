import { FieldsPage } from "@/components/custom-fields/FieldsPage";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `Fields · ${APP_TITLE}` },
    {
      name: "description",
      content: "Define reusable custom fields for tasks.",
    },
  ];
}

export default function FieldsRoute() {
  return <FieldsPage />;
}
