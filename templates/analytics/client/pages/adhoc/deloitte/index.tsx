import { useState, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { AgentChatUsersTable } from "./FusionUsersTable";
import { ActivityCharts } from "./ActivityCharts";
import { SalesRecommendations } from "./SalesRecommendations";

function useUrlParam(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || defaultValue;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    const s = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [value, key, defaultValue]);

  return [value, setValue];
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function get90DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

export default function DeloitteDashboard() {
  const [dateStart, setDateStart] = useUrlParam("from", get90DaysAgo());
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deloitte Account Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fusion usage and Builder activity for Deloitte users
        </p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">From</label>
            <DatePicker value={dateStart} onChange={setDateStart} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">To</label>
            <DatePicker value={dateEnd} onChange={setDateEnd} />
          </div>
        </div>
      </div>

      <ActivityCharts dateStart={dateStart} dateEnd={dateEnd} />
      <AgentChatUsersTable dateStart={dateStart} dateEnd={dateEnd} />
      <SalesRecommendations />
    </div>
  );
}
