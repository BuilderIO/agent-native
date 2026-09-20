import { FieldsPage } from "@/components/custom-fields/FieldsPage";
import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${messages.fields.pageTitle} · ${APP_TITLE}` },
    {
      name: "description",
      content: "Define reusable custom fields for tasks.",
    },
  ];
}

export default function FieldsRoute() {
  return <FieldsPage />;
}
