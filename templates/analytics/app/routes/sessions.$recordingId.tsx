import enUSMessages from "@/i18n/en-US";
import SessionDetailPage from "@/pages/sessions/SessionDetailPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.session }];
}

export default function SessionDetailRoute() {
  return <SessionDetailPage />;
}
