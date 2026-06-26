import { messagesByLocale } from "@/i18n-data";
import SessionDetailPage from "@/pages/sessions/SessionDetailPage";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.session }];
}

export default function SessionDetailRoute() {
  return <SessionDetailPage />;
}
