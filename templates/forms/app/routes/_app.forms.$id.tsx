import { useParams } from "react-router";

import messages from "@/i18n/en-US";
import { FormBuilderPage } from "@/pages/FormBuilderPage";

export function meta() {
  return [{ title: messages.routeTitles.editFormForms }];
}

export default function FormBuilderRoute() {
  // Remount per form: the builder keeps local field/selection state, and a
  // reused instance would publish the previous form's selected field under
  // the new form id until its fields synchronized.
  const { id } = useParams();
  return <FormBuilderPage key={id} />;
}
