import { useState, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { CustomerSearch } from "./CustomerSearch";
import { HealthSummaryCards } from "./HealthSummaryCards";
import { AgentChatActivityChart } from "./FusionActivityChart";
import { TopAgentChatUsers } from "./TopFusionUsers";
import { SubscriptionDetails } from "./SubscriptionDetails";
import { RecentTickets } from "./RecentTickets";
import { GongCalls } from "./GongCalls";

function useUrlParam(
  key: string,
  defaultValue: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key) || defaultValue;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) params.delete(key);
    else params.set(key, value);
    const s = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${s ? `?${s}` : ""}`,
    );
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

export default function CustomerHealthDashboard() {
  const [company, setCompany] = useState<string | null>("Intuit");
  const [dateStart, setDateStart] = useUrlParam("from", get90DaysAgo());
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Customer Health Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search a customer by company name to view their health metrics, Fusion
          usage, and subscription details.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
            <label className="text-xs text-muted-foreground font-medium">
              Company
            </label>
            <CustomerSearch
              onSelect={(name) => setCompany(name || null)}
              selectedCompany={company}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              From
            </label>
            <DatePicker value={dateStart} onChange={setDateStart} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              To
            </label>
            <DatePicker value={dateEnd} onChange={setDateEnd} />
          </div>
        </div>
      </div>

      {!company && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <svg
              className="h-8 w-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium">Search for a customer</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Enter a company name above to load their health dashboard with
            Fusion usage, subscriptions, and user activity.
          </p>
        </div>
      )}

      {company && (
        <>
          <HealthSummaryCards companyName={company} />

          <div>
            <h2 className="text-lg font-semibold mb-3">Agent Chat Activity</h2>
            <AgentChatActivityChart
              companyName={company}
              dateStart={dateStart}
              dateEnd={dateEnd}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopAgentChatUsers
              companyName={company}
              dateStart={dateStart}
              dateEnd={dateEnd}
            />
            <SubscriptionDetails companyName={company} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RecentTickets companyName={company} />
            <GongCalls companyName={company} />
          </div>
        </>
      )}
    </div>
  );
}
