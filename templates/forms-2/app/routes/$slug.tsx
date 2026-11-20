import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { PublicForm } from "@/components/respond/PublicForm";
import { FormSkeleton, UnavailableState } from "@/components/respond/states";

export function meta() {
  return [{ title: "Form" }];
}

/** A published form on a verified custom domain, at the domain's /<slug>. */
export default function CustomDomainFormRoute() {
  const { slug = "" } = useParams();
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.host), []);
  const { data, isLoading } = useActionQuery(
    "get-domain-form",
    { host: host ?? "", slug },
    { enabled: host !== null },
  );

  if (host === null || isLoading) return <FormSkeleton />;
  if (!data?.formId) return <UnavailableState />;
  return <PublicForm formId={data.formId} />;
}
