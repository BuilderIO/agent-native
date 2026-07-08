import { DispatchControlPlane } from "../../components/dispatch-control-plane";

const SEO_TITLE =
  "Agent-Native Dispatch - Open Source workspace control plane for AI agents";
const SEO_DESCRIPTION =
  "Open Source workspace control plane for AI agents to manage apps, secrets, approvals, messages, jobs, and cross-app delegation.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function OverviewRoute() {
  return <DispatchControlPlane />;
}
