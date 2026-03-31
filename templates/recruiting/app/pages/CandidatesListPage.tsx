import { useState } from "react";
import { useNavigate } from "react-router";
import { useCandidates } from "@/hooks/use-greenhouse";
import {
  formatRelativeDate,
  getInitials,
  getAvatarColor,
  titleCase,
  cn,
} from "@/lib/utils";
import { IconSearch, IconLoader2, IconUsers } from "@tabler/icons-react";

export function CandidatesListPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const {
    data: candidates = [],
    isLoading,
    error,
  } = useCandidates({
    search: debouncedSearch || undefined,
  });
  const navigate = useNavigate();

  // Simple debounce
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout((window as any).__candidateSearchTimeout);
    (window as any).__candidateSearchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-sm font-semibold text-foreground">Candidates</h1>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search candidates..."
            className="h-8 w-64 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-ring"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconUsers className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium text-foreground mb-1">
              Failed to load candidates
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
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <IconUsers className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">
              {debouncedSearch
                ? "No candidates match your search"
                : "No candidates found"}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th
                  scope="col"
                  className="px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Email
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Company
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Current Stage
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Tags
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right"
                >
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {candidates.map((candidate) => {
                const name = titleCase(
                  `${candidate.first_name} ${candidate.last_name}`,
                );
                const email = candidate.emails[0]?.value;
                const initials = getInitials(name);
                const color = getAvatarColor(name);
                const activeApp = candidate.applications.find(
                  (a) => a.status === "active",
                );

                return (
                  <tr
                    key={candidate.id}
                    onClick={() => navigate(`/candidates/${candidate.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        navigate(`/candidates/${candidate.id}`);
                    }}
                    tabIndex={0}
                    role="button"
                    className="list-row cursor-pointer hover:bg-accent/50"
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                            color,
                          )}
                        >
                          {initials}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {name}
                          </div>
                          {candidate.title && (
                            <div className="text-xs text-muted-foreground">
                              {candidate.title}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {email || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {candidate.company || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {activeApp?.current_stage ? (
                        <span className="text-xs text-muted-foreground">
                          {activeApp.current_stage.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {candidate.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {candidate.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{candidate.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground text-right tabular-nums">
                      {formatRelativeDate(candidate.last_activity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
