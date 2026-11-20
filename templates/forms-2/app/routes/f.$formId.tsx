import { useParams } from "react-router";

import { PublicForm } from "@/components/respond/PublicForm";

export function meta() {
  return [{ title: "Form" }];
}

export default function PublicFormRoute() {
  const { formId = "" } = useParams();
  return <PublicForm formId={formId} />;
}
