import { messagesByLocale } from "@/i18n-data";
import AdhocRouter from "@/pages/adhoc/AdhocRouter";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.dashboard }];
}

export default function DashboardRoute() {
  return <AdhocRouter />;
}
