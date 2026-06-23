import AdhocRouter from "@/pages/adhoc/AdhocRouter";

export function meta() {
  return [{ title: "Dashboard — Analytics" }];
}

export default function DashboardRoute() {
  return <AdhocRouter />;
}
