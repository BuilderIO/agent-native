import enUSMessages from "@/i18n/en-US";
import SessionReportPage from "@/pages/sessions/SessionReportPage";

export function meta() {
  return [{ title: enUSMessages.routeTitles.sessionReport }];
}

export default function SessionReportRoute() {
  return <SessionReportPage />;
}
