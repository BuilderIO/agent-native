import { useState, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FunnelChart } from "./FunnelChart";
import { TimeToCompleteChart } from "./TimeToCompleteChart";
import { CohortAnalysisChart } from "./CohortAnalysisChart";
import { DropoffAnalysisChart } from "./DropoffAnalysisChart";
import { DailyTrendsChart } from "./DailyTrendsChart";

type CohortDimension = "week" | "space_kind" | "plan";

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
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
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

function get30DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function OnboardingFunnelDashboard() {
  const [dateStart, setDateStart] = useUrlParam("from", get30DaysAgo());
  const [dateEnd, setDateEnd] = useUrlParam("to", getToday());
  const [cohortDimension, setCohortDimension] = useUrlParam("cohort", "week");

  return (
    <div className="space-y-6">
      <DashboardHeader description="Complete user journey from signup to onboarding completion with drop-off analysis, timing metrics, and cohort segmentation" />

      {/* Controls */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap gap-3 items-end">
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Cohort View
            </label>
            <Select value={cohortDimension} onValueChange={setCohortDimension}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week" className="text-xs">
                  By Week
                </SelectItem>
                <SelectItem value="space_kind" className="text-xs">
                  By Product Type
                </SelectItem>
                <SelectItem value="plan" className="text-xs">
                  By Plan/Tier
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Overall Funnel */}
      <FunnelChart dateStart={dateStart} dateEnd={dateEnd} />

      {/* Drop-off Analysis */}
      <DropoffAnalysisChart dateStart={dateStart} dateEnd={dateEnd} />

      {/* Time to Complete */}
      <TimeToCompleteChart dateStart={dateStart} dateEnd={dateEnd} />

      {/* Daily Trends */}
      <DailyTrendsChart dateStart={dateStart} dateEnd={dateEnd} />

      {/* Cohort Analysis */}
      <CohortAnalysisChart
        dateStart={dateStart}
        dateEnd={dateEnd}
        dimension={cohortDimension as CohortDimension}
      />

      {/* Event Definitions */}
      <div className="rounded-lg border border-border/50 p-4 text-xs text-muted-foreground space-y-3">
        <div className="font-semibold text-foreground text-sm">
          Event Definitions
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <span className="font-medium text-foreground">
              Submit Signup Form:
            </span>{" "}
            User submits the signup form (pre-account creation)
          </div>
          <div>
            <span className="font-medium text-foreground">Account Signup:</span>{" "}
            Account successfully created in Firebase/Builder
          </div>
          <div>
            <span className="font-medium text-foreground">
              Onboarding Shown:
            </span>{" "}
            Onboarding flow UI displayed to user
          </div>
          <div>
            <span className="font-medium text-foreground">
              Step Impression:
            </span>{" "}
            User views an onboarding step
          </div>
          <div>
            <span className="font-medium text-foreground">
              Click Next Button:
            </span>{" "}
            User progresses through onboarding steps
          </div>
          <div>
            <span className="font-medium text-foreground">
              Space Kind Selected:
            </span>{" "}
            User selects product type (CMS, Projects, etc.)
          </div>
          <div>
            <span className="font-medium text-foreground">
              Complete Onboarding:
            </span>{" "}
            User successfully completes entire onboarding flow
          </div>
        </div>
      </div>
    </div>
  );
}
