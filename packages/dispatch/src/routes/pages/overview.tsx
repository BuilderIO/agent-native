import { DispatchControlPlane } from "@/components/dispatch-control-plane";

export function meta() {
  return [{ title: "Overview — Dispatch" }];
}

export default function OverviewRoute() {
  return <DispatchControlPlane />;
}
