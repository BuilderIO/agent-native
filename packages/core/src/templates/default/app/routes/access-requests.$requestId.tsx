import { AccessRequestApprovalPage } from "@agent-native/toolkit/app/sharing";

// Where access request emails and notifications lead. Opt a resource into
// requests with `accessRequests: true` on its `registerShareableResource`.
export default function AccessRequestRoute() {
  return <AccessRequestApprovalPage landmark />;
}
