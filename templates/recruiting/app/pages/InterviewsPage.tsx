import { useInterviews } from "@/hooks/use-greenhouse";
import { groupByDate, cn } from "@/lib/utils";
import { format } from "date-fns";
import { IconLoader2, IconCalendar } from "@tabler/icons-react";

export function InterviewsPage() {
  const { data: interviews = [], isLoading, error } = useInterviews();

  // Only future interviews, sorted by start time
  const now = new Date();
  const upcoming = interviews
    .filter((i) => new Date(i.start.date_time) > now)
    .sort(
      (a, b) =>
        new Date(a.start.date_time).getTime() -
        new Date(b.start.date_time).getTime(),
    );

  const grouped = groupByDate(
    upcoming.map((i) => ({
      ...i,
      date: i.start.date_time,
    })),
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 h-14 flex-shrink-0 sm:px-6">
        <h1 className="text-sm font-semibold text-foreground pl-10 md:pl-0">
          Interviews
        </h1>
        <span className="ml-2 text-xs text-muted-foreground">
          {upcoming.length} upcoming
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconCalendar className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground mb-1">
              Failed to load interviews
            </p>
            <p className="text-xs mb-3">
              Check your Greenhouse connection in Settings.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-green-600 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconCalendar className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No upcoming interviews</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 sm:px-6">
            {grouped.map((group) => (
              <div key={group.label}>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {group.label}
                </h2>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {group.items.map((interview: any) => (
                    <div
                      key={interview.id}
                      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                    >
                      <div className="flex items-center gap-3 min-w-0 sm:gap-4">
                        <div className="w-16 flex-shrink-0 text-right sm:w-20">
                          <div className="text-sm font-medium text-foreground tabular-nums">
                            {format(
                              new Date(interview.start.date_time),
                              "h:mm a",
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {format(
                              new Date(interview.end.date_time),
                              "h:mm a",
                            )}
                          </div>
                        </div>

                        <div className="h-8 w-px bg-border hidden sm:block" />

                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {interview.organizer?.name ?? "Interview"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {(interview.interviewers || [])
                              .map((i: any) => i.name)
                              .join(", ")}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 pl-[calc(4rem+0.75rem)] sm:gap-3 sm:pl-0">
                        {interview.location && (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[160px]">
                            {interview.location}
                          </span>
                        )}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                            interview.status === "scheduled"
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {interview.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
