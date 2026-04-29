import { useState } from "react";
import { useNavigate } from "react-router";
import { useJobs } from "@/hooks/use-greenhouse";
import { formatDateShort, cn } from "@/lib/utils";
import { IconSearch, IconLoader2, IconBriefcase } from "@tabler/icons-react";
import {
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";

export function JobsListPage() {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [search, setSearch] = useState("");
  const {
    data: jobs = [],
    isLoading,
    error,
  } = useJobs(statusFilter || undefined);
  const navigate = useNavigate();

  const filtered = search
    ? jobs.filter(
        (j) =>
          j.name.toLowerCase().includes(search.toLowerCase()) ||
          j.departments.some((d) =>
            d.name.toLowerCase().includes(search.toLowerCase()),
          ),
      )
    : jobs;

  const statuses = [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
    { value: "draft", label: "Draft" },
    { value: "", label: "All" },
  ];

  useSetPageTitle(
    <div className="flex items-center gap-3">
      <h1 className="text-sm font-semibold text-foreground">Jobs</h1>
      <div className="flex items-center gap-0.5">
        {statuses.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={cn(
              "cursor-pointer rounded-md px-2 py-1 text-xs font-medium",
              statusFilter === s.value
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>,
  );

  useSetHeaderActions(
    <div className="relative">
      <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search jobs..."
        className="h-8 w-44 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring sm:w-56"
      />
    </div>,
  );

  return (
    <div className="h-full flex flex-col">

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconBriefcase className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground mb-1">
              Failed to load jobs
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconBriefcase className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">
              {search
                ? "No jobs match your search"
                : `No ${statusFilter || ""} jobs found`}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile list */}
            <div className="divide-y divide-border sm:hidden">
              {filtered.map((job) => (
                <div
                  key={job.id}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {job.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {job.departments.map((d) => d.name).join(", ") ||
                        "No dept"}
                      {job.offices.length > 0 &&
                        ` · ${job.offices.map((o) => o.name).join(", ")}`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium flex-shrink-0",
                      job.status === "open"
                        ? "bg-green-500/10 text-green-600"
                        : job.status === "closed"
                          ? "bg-red-500/10 text-red-600"
                          : "bg-yellow-500/10 text-yellow-600",
                    )}
                  >
                    {job.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th
                      scope="col"
                      className="px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Job
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Department
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell"
                    >
                      Office
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Openings
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right"
                    >
                      Opened
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(`/jobs/${job.id}`);
                        }
                      }}
                      tabIndex={0}
                      className="list-row cursor-pointer hover:bg-accent/50"
                    >
                      <td className="px-6 py-3">
                        <div className="text-sm font-medium text-foreground">
                          {job.name}
                        </div>
                        {job.requisition_id && (
                          <div className="text-xs text-muted-foreground">
                            REQ-{job.requisition_id}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {job.departments.map((d) => d.name).join(", ") ||
                          "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                        {job.offices.map((o) => o.name).join(", ") || "\u2014"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            job.status === "open"
                              ? "bg-green-500/10 text-green-600"
                              : job.status === "closed"
                                ? "bg-red-500/10 text-red-600"
                                : "bg-yellow-500/10 text-yellow-600",
                          )}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                        {job.openings?.length ?? 0}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                        {job.opened_at
                          ? formatDateShort(job.opened_at)
                          : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
