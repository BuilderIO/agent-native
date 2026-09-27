import { useParams } from "react-router";

import messages from "@/i18n/en-US";
import { FormBuilderPage } from "@/pages/FormBuilderPage";

export function meta() {
  return [{ title: messages.routeTitles.editFormForms }];
}

export default function FormBuilderRoute() {
  const { id } = useParams();
  return <FormBuilderPage key={id} />;
}
