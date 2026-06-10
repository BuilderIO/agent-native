import { InboxPage } from "@/pages/InboxPage";

export function meta() {
  return [{ title: "Agent-Native Mail" }];
}

export default function ThreadRoute() {
  return <InboxPage />;
}
