import { FirstTouchTraffic } from "./components/FirstTouchTraffic";
import { SubviewBar } from "./components/SubviewBar";
import { dashboards } from "@/pages/adhoc/registry";

const topFunnelMeta = dashboards.find((d) => d.id === "top-funnel");
const builtInSubviews = topFunnelMeta?.subviews ?? [];

export default function TopFunnelDashboard() {
  return (
    <div className="space-y-2">
      <SubviewBar builtIn={builtInSubviews} basePath="/adhoc/top-funnel" />
      <div className="border-b border-border" />
      <FirstTouchTraffic />
    </div>
  );
}
