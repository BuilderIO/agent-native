import { useMemo } from "react";
import {
  Users,
  Building2,
  DollarSign,
  MessageSquare,
  UserCheck,
  Crown,
  CalendarClock,
} from "lucide-react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { Skeleton } from "@/components/ui/skeleton";
import {
  summaryMetricsQuery,
  agentChatMetrics30dQuery,
  renewalDateQuery,
} from "./queries";

interface HealthSummaryCardsProps {
  companyName: string;
}

interface CardData {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  isLoading,
}: CardData & { isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`rounded-md p-1.5 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <p className="text-2xl font-bold tabular-nums truncate">{value}</p>
      )}
    </div>
  );
}

function formatPlan(plans: string): string {
  const planList = plans.split(",").map((p) => p.trim().toLowerCase());
  if (planList.includes("enterprise")) return "Enterprise";
  // Capitalize first letter of each
  return [...new Set(planList)]
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(", ");
}

export function HealthSummaryCards({ companyName }: HealthSummaryCardsProps) {
  const summarySql = useMemo(
    () => summaryMetricsQuery(companyName),
    [companyName],
  );
  const agentChatSql = useMemo(
    () => agentChatMetrics30dQuery(companyName),
    [companyName],
  );
  const renewalSql = useMemo(
    () => renewalDateQuery(companyName),
    [companyName],
  );

  const summary = useMetricsQuery(["ch-summary", companyName], summarySql);
  const agentChat = useMetricsQuery(
    ["ch-agent-chat-30d", companyName],
    agentChatSql,
  );
  const renewal = useMetricsQuery(["ch-renewal", companyName], renewalSql);

  const s = summary.data?.rows?.[0];
  const f = agentChat.data?.rows?.[0];
  const r = renewal.data?.rows?.[0];

  const isLoading = summary.isLoading || agentChat.isLoading;

  const formatArr = (val: unknown) => {
    const num = Number(val);
    if (!num) return "$0";
    if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
    return `$${num.toLocaleString()}`;
  };

  const formatRenewalDate = () => {
    if (renewal.isLoading) return "...";
    if (!r?.upcoming_renewal_date) return "—";
    const d = new Date(String(r.upcoming_renewal_date));
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const cards: CardData[] = [
    {
      label: "Total Users",
      value: s ? Number(s.total_users).toLocaleString() : "—",
      icon: Users,
      color: "bg-blue-500/10 text-blue-500",
    },
    {
      label: "Active Spaces",
      value: s ? Number(s.active_spaces).toLocaleString() : "—",
      icon: Building2,
      color: "bg-purple-500/10 text-purple-500",
    },
    {
      label: "ARR",
      value: s ? formatArr(s.total_arr) : "—",
      icon: DollarSign,
      color: "bg-green-500/10 text-green-500",
    },
    {
      label: "Plan",
      value: s?.plans ? formatPlan(String(s.plans)) : "—",
      icon: Crown,
      color: "bg-amber-500/10 text-amber-500",
    },
    {
      label: "Next Renewal",
      value: formatRenewalDate(),
      icon: CalendarClock,
      color: "bg-orange-500/10 text-orange-500",
    },
    {
      label: "Agent Chat Messages (30d)",
      value: f ? Number(f.total_messages).toLocaleString() : "—",
      icon: MessageSquare,
      color: "bg-cyan-500/10 text-cyan-500",
    },
    {
      label: "Agent Chat Active Users (30d)",
      value: f ? Number(f.unique_users).toLocaleString() : "—",
      icon: UserCheck,
      color: "bg-indigo-500/10 text-indigo-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {cards.map((card) => (
        <KpiCard key={card.label} {...card} isLoading={isLoading} />
      ))}
    </div>
  );
}
