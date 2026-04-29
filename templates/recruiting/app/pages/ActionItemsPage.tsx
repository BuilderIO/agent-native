import { useState } from "react";
import { useNavigate } from "react-router";
import {
  useActionItems,
  useSendRecruiterUpdate,
  useNotificationStatus,
} from "@/hooks/use-greenhouse";
import { cn, getInitials, getAvatarColor, titleCase } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  IconLoader2,
  IconAlertTriangle,
  IconClockHour4,
  IconCheck,
  IconSend,
  IconChevronDown,
  IconChevronUp,
  IconHourglass,
  IconStarFilled,
  IconThumbUp,
  IconThumbDown,
  IconX,
  IconQuestionMark,
  IconBrandSlack,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";

function RecommendationBadge({ rec }: { rec: string }) {
  const config: Record<
    string,
    { icon: typeof IconCheck; color: string; label: string }
  > = {
    strong_yes: {
      icon: IconStarFilled,
      color: "text-green-600 bg-green-500/10",
      label: "Strong Yes",
    },
    yes: {
      icon: IconThumbUp,
      color: "text-emerald-600 bg-emerald-500/10",
      label: "Yes",
    },
    no: {
      icon: IconThumbDown,
      color: "text-orange-600 bg-orange-500/10",
      label: "No",
    },
    strong_no: {
      icon: IconX,
      color: "text-red-600 bg-red-500/10",
      label: "Strong No",
    },
  };
  const c = config[rec] || {
    icon: IconQuestionMark,
    color: "text-muted-foreground bg-muted",
    label: rec?.replace(/_/g, " ") || "Unknown",
  };
  const Icon = c.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        c.color,
      )}
    >
      <Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}

export function ActionItemsPage() {
  const { data, isLoading, error, refetch } = useActionItems();
  const { data: notifStatus } = useNotificationStatus();
  const sendUpdate = useSendRecruiterUpdate();
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    overdue: true,
    pending: true,
    recent: true,
    stuck: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSendUpdate = async () => {
    if (!data) return;
    try {
      await sendUpdate.mutateAsync({ actionItems: data });
      toast.success("Recruiter update sent to Slack");
    } catch (err: any) {
      toast.error(err.message || "Failed to send update");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Loading pipeline status...
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <p className="text-sm text-muted-foreground mb-3">
          {error ? "Failed to load action items" : "No data available"}
        </p>
        <button
          onClick={() => refetch()}
          className="text-xs text-green-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="h-full flex flex-col">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 sm:px-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Overdue Scorecards"
              count={summary.overdueScorecardCount}
              icon={IconAlertTriangle}
              color={
                summary.overdueScorecardCount > 0
                  ? "text-red-500 bg-red-500/10"
                  : "text-muted-foreground bg-muted"
              }
            />
            <SummaryCard
              label="Pending Feedback"
              count={summary.pendingScorecardCount}
              icon={IconClockHour4}
              color={
                summary.pendingScorecardCount > 0
                  ? "text-amber-500 bg-amber-500/10"
                  : "text-muted-foreground bg-muted"
              }
            />
            <SummaryCard
              label="Recent Feedback"
              count={summary.recentScorecardCount}
              icon={IconCheck}
              color={
                summary.recentScorecardCount > 0
                  ? "text-green-500 bg-green-500/10"
                  : "text-muted-foreground bg-muted"
              }
            />
            <SummaryCard
              label="Stuck Candidates"
              count={summary.stuckCandidateCount}
              icon={IconHourglass}
              color={
                summary.stuckCandidateCount > 0
                  ? "text-orange-500 bg-orange-500/10"
                  : "text-muted-foreground bg-muted"
              }
            />
          </div>

          {/* Overdue Scorecards */}
          {data.overdueScorecards.length > 0 && (
            <Section
              title="Overdue Scorecards"
              subtitle="Interview completed but feedback not submitted"
              count={data.overdueScorecards.length}
              color="text-red-600"
              icon={IconAlertTriangle}
              expanded={expandedSections.overdue}
              onToggle={() => toggleSection("overdue")}
            >
              <div className="rounded-lg border border-border divide-y divide-border">
                {data.overdueScorecards.map((item) => {
                  const name = titleCase(item.candidateName);
                  const initials = getInitials(name);
                  const color = getAvatarColor(name);
                  return (
                    <div
                      key={`${item.interview.id}-overdue`}
                      className="flex items-center justify-between gap-3 px-3 py-3 text-sm cursor-pointer hover:bg-accent/50 sm:px-4"
                      onClick={() =>
                        navigate(`/candidates/${item.candidateId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                            color,
                          )}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.jobName}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-red-600 font-medium">
                            {item.hoursSinceInterview}h overdue
                          </div>
                          <div className="text-[11px] text-muted-foreground hidden sm:block">
                            Missing:{" "}
                            {item.missingFrom.map((m) => m.name).join(", ")}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Pending Scorecards */}
          {data.pendingScorecards.length > 0 && (
            <Section
              title="Pending Feedback"
              subtitle="Interview recently completed, awaiting scorecards"
              count={data.pendingScorecards.length}
              color="text-amber-600"
              icon={IconClockHour4}
              expanded={expandedSections.pending}
              onToggle={() => toggleSection("pending")}
            >
              <div className="rounded-lg border border-border divide-y divide-border">
                {data.pendingScorecards.map((item) => {
                  const name = titleCase(item.candidateName);
                  const initials = getInitials(name);
                  const color = getAvatarColor(name);
                  return (
                    <div
                      key={`${item.interview.id}-pending`}
                      className="flex items-center justify-between gap-3 px-3 py-3 text-sm cursor-pointer hover:bg-accent/50 sm:px-4"
                      onClick={() =>
                        navigate(`/candidates/${item.candidateId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                            color,
                          )}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.jobName}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-amber-600 font-medium">
                            {item.hoursSinceInterview}h ago
                          </div>
                          <div className="text-[11px] text-muted-foreground hidden sm:block">
                            Waiting:{" "}
                            {item.missingFrom.map((m) => m.name).join(", ")}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Recent Scorecards */}
          {data.recentScorecards.length > 0 && (
            <Section
              title="Recent Feedback"
              subtitle="Scorecards submitted in the last 7 days"
              count={data.recentScorecards.length}
              color="text-green-600"
              icon={IconCheck}
              expanded={expandedSections.recent}
              onToggle={() => toggleSection("recent")}
            >
              <div className="rounded-lg border border-border divide-y divide-border">
                {data.recentScorecards.map((item) => {
                  const name = titleCase(item.candidateName);
                  const initials = getInitials(name);
                  const color = getAvatarColor(name);
                  return (
                    <div
                      key={`${item.scorecard.id}-recent`}
                      className="flex items-center justify-between gap-3 px-3 py-3 text-sm cursor-pointer hover:bg-accent/50 sm:px-4"
                      onClick={() =>
                        navigate(`/candidates/${item.candidateId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                            color,
                          )}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.jobName} · {item.interviewName}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 sm:gap-3">
                        <RecommendationBadge
                          rec={item.scorecard.overall_recommendation}
                        />
                        <div className="text-right hidden sm:block">
                          <div className="text-xs text-muted-foreground">
                            {item.scorecard.submitted_by.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(
                              new Date(item.scorecard.submitted_at),
                              { addSuffix: true },
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Stuck Candidates */}
          {data.stuckCandidates.length > 0 && (
            <Section
              title="Stuck Candidates"
              subtitle="No activity for 5+ days"
              count={data.stuckCandidates.length}
              color="text-orange-600"
              icon={IconHourglass}
              expanded={expandedSections.stuck}
              onToggle={() => toggleSection("stuck")}
            >
              <div className="rounded-lg border border-border divide-y divide-border">
                {data.stuckCandidates.map((item) => {
                  const name = titleCase(item.candidateName);
                  const initials = getInitials(name);
                  const color = getAvatarColor(name);
                  return (
                    <div
                      key={`${item.applicationId}-stuck`}
                      className="flex items-center justify-between gap-3 px-3 py-3 text-sm cursor-pointer hover:bg-accent/50 sm:px-4"
                      onClick={() =>
                        navigate(`/candidates/${item.candidateId}`)
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                            color,
                          )}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">
                            {name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {item.jobName} · {item.stageName}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="inline-flex items-center rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-600">
                          {item.daysInStage}d inactive
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* All clear */}
          {summary.totalActionItems === 0 &&
            data.pendingScorecards.length === 0 &&
            data.recentScorecards.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <IconCheck className="h-8 w-8 mb-2 text-green-500 opacity-60" />
                <p className="text-sm font-medium text-foreground">All clear</p>
                <p className="text-xs">No action items right now</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  icon: Icon,
  color,
}: {
  label: string;
  count: number;
  icon: typeof IconCheck;
  color: string;
}) {
  const [iconColor, bgColor] = color.split(" ");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          bgColor,
        )}
      >
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div>
        <div className="text-lg font-semibold text-foreground tabular-nums">
          {count}
        </div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  color,
  icon: Icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  color: string;
  icon: typeof IconCheck;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full mb-2 gap-2 group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 flex-shrink-0", color)} />
          <h2 className="text-sm font-medium text-foreground truncate">
            {title}
          </h2>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            ({count})
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            {subtitle}
          </span>
          {expanded ? (
            <IconChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded && children}
    </div>
  );
}
