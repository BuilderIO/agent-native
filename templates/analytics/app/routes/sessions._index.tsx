import enUSMessages from "@/i18n/en-US";
import SessionsPage from "@/pages/sessions/SessionsPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.sessions }];
}

export default function SessionsRoute() {
  return <SessionsPage />;
}
