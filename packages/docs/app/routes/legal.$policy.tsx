import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import LegalPolicyPage from "../components/LegalPolicyPage";
import { getAdditionalLegalPolicy } from "../legal-policy-content";
import { withDefaultSocialImage } from "../seo";

export async function loader({ params }: LoaderFunctionArgs) {
  const policy = getAdditionalLegalPolicy(params.policy ?? "");
  if (!policy) throw new Response("Not Found", { status: 404 });
  return policy;
}

export const meta = ({
  data,
  loaderData,
}: {
  data?: Awaited<ReturnType<typeof loader>>;
  loaderData?: Awaited<ReturnType<typeof loader>>;
}) => {
  const policy = data ?? loaderData;
  if (!policy) return withDefaultSocialImage([{ title: "Not Found" }]);

  return withDefaultSocialImage([
    { title: policy.title + " - Agent-Native" },
    { name: "description", content: policy.description },
    { property: "og:title", content: policy.title + " - Agent-Native" },
    { property: "og:description", content: policy.description },
  ]);
};

export default function LegalPolicyRoute() {
  const policy = useLoaderData<typeof loader>();
  return <LegalPolicyPage markdown={policy.markdown} />;
}
