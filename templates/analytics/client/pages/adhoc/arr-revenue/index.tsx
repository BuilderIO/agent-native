import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SummaryCards } from "./SummaryCards";
import { ArrOverTimeChart } from "./ArrOverTimeChart";
import { QuarterSummary } from "./QuarterSummary";
import { StatusBreakdown } from "./StatusBreakdown";
import { ProductBreakdown } from "./ProductBreakdown";
import { TopCustomers } from "./TopCustomers";
import { EventsTable } from "./EventsTable";

type Cadence = "Daily" | "Weekly" | "Monthly" | "Quarterly";

const CADENCES: Cadence[] = ["Monthly", "Weekly", "Daily", "Quarterly"];
const PRODUCT_GROUPS = ["All", "CMS + AI", "Shopify"];
const FISCAL_YEARS = [2026, 2025, 2024, 2023];

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

export default function ArrRevenueDashboard() {
  const [fiscalYearStr, setFiscalYearStr] = useUrlParam("fy", "2026");
  const [cadence, setCadence] = useUrlParam("cadence", "Monthly");
  const [productGroup, setProductGroup] = useUrlParam("product", "All");

  const fiscalYear = Number(fiscalYearStr);
  const productFilter = productGroup === "All" ? undefined : productGroup;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          ARR Revenue w/ Fiscal Date
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          ARR changes tracker with fiscal calendar dimensions &mdash; reproduced
          from the Sigma "ARR Changes" dataset
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Fiscal Year
            </label>
            <Select value={fiscalYearStr} onValueChange={setFiscalYearStr}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FISCAL_YEARS.map((fy) => (
                  <SelectItem key={fy} value={String(fy)} className="text-xs">
                    FY {fy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Cadence
            </label>
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              {CADENCES.map((c) => (
                <Button
                  key={c}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    cadence === c && "bg-secondary text-secondary-foreground",
                  )}
                  onClick={() => setCadence(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              Product Group
            </label>
            <Select value={productGroup} onValueChange={setProductGroup}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_GROUPS.map((pg) => (
                  <SelectItem key={pg} value={pg} className="text-xs">
                    {pg}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <SummaryCards fiscalYear={fiscalYear} />

      <ArrOverTimeChart
        fiscalYear={fiscalYear}
        cadence={cadence as Cadence}
        productGroup={productFilter}
      />

      <QuarterSummary fiscalYear={fiscalYear} />

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBreakdown fiscalYear={fiscalYear} productGroup={productFilter} />
        <div /> {/* spacer for layout balance */}
      </div>

      <ProductBreakdown fiscalYear={fiscalYear} />

      <TopCustomers fiscalYear={fiscalYear} />

      <EventsTable fiscalYear={fiscalYear} />

      {/* Definitions */}
      <div className="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">Data Source</span>{" "}
          &mdash;{" "}
          <code className="text-[10px]">
            finance.arr_revenue_tracker_latest
          </code>{" "}
          joined with <code className="text-[10px]">dbt_mart.dim_date</code> for
          fiscal calendar,{" "}
          <code className="text-[10px]">polytomic.stripe_customers</code> for
          Stripe metadata, and{" "}
          <code className="text-[10px]">dbt_mapping.legacy_product_proxy</code>{" "}
          for product proxy mapping.
        </p>
        <p>
          <span className="font-medium text-foreground">Event Date Fix</span>{" "}
          &mdash; Events before 2023-11-01 use UTC interpretation; after that
          date they use America/Los_Angeles timezone.
        </p>
        <p>
          <span className="font-medium text-foreground">Product Groups</span>{" "}
          &mdash; "CMS + AI" includes CMS, VCP, and Develop products. "Shopify"
          is Shopify-sourced revenue.
        </p>
        <p>
          <span className="font-medium text-foreground">Status Groups</span>{" "}
          &mdash; "New / Reactivate" combines New and Reactivate statuses.
          "Churn / Downgrade" combines Churn and Downgrade.
        </p>
      </div>
    </div>
  );
}
