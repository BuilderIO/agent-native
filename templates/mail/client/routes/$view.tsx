import { InboxPage } from "@/pages/InboxPage";
import { MailSkeleton } from "@/components/layout/MailSkeleton";

export function meta() {
  return [{ title: "Mail" }];
}

export function HydrateFallback() {
  return <MailSkeleton />;
}

export default function ViewRoute() {
  return <InboxPage />;
}
