import { FormBuilderPage } from "@/pages/FormBuilderPage";
import messages from "@/i18n/en-US";

export function meta() {
  return [{ title: messages.routeTitles.editFormForms }];
}

export default function FormBuilderRoute() {
  return <FormBuilderPage />;
}
