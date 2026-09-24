import enUSMessages from "@/i18n/en-US";
import AdhocRouter from "@/pages/adhoc/AdhocRouter";

export function meta() {
  return [{ title: enUSMessages.routeTitles.dashboard }];
}

export default function DashboardRoute() {
  return <AdhocRouter />;
}
