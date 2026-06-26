import { messagesByLocale } from "@/i18n-data";
import SessionsPage from "@/pages/sessions/SessionsPage";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.sessions }];
}

export default function SessionsRoute() {
  return <SessionsPage />;
}
