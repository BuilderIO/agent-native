import { redirect } from "react-router";
import { MailSkeleton } from "@/components/layout/MailSkeleton";

export function meta() {
  return [{ title: "Mail" }];
}

export function clientLoader() {
  throw redirect("/inbox");
}

export function HydrateFallback() {
  return <MailSkeleton />;
}

export default function IndexRoute() {
  // This should never render — clientLoader redirects to /inbox
  return null;
}
