import messages from "@/i18n/en-US";
import { FormBuilderPage } from "@/pages/FormBuilderPage";

export function meta() {
  return [{ title: messages.routeTitles.editFormForms }];
}

export default function FormBuilderRoute() {
  return <FormBuilderPage />;
}
