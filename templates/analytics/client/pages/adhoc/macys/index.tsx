import { useState, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { ActivityCharts } from "./ActivityCharts";
import { UsersTables } from "./UsersTables";

function useUrlParam(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || defaultValue;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
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

export default function MacysDashboard() {
  const [dateStart, setDateStart] = useUrlParam("from", get90DaysAgo());
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());

  return (
    <div className="space-y-6">
      <DashboardHeader description="Fusion usage, Builder activity, and account details for Macy's" />

      {/* Date Controls */}
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
      <UsersTables dateStart={dateStart} dateEnd={dateEnd} />
    </div>
  );
}
