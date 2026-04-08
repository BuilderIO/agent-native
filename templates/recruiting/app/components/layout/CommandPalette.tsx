import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconSettings,
  IconSearch,
  IconUser,
} from "@tabler/icons-react";
import { useCandidates, useJobs } from "@/hooks/use-greenhouse";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: candidates, isFetching: candidatesLoading } = useCandidates(
    open
      ? {
          search: search || undefined,
          limit: search ? 8 : undefined,
        }
      : undefined,
  );
  const { data: jobs } = useJobs(open ? "open" : undefined);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Always close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onOpenChange]);

  const filteredJobs = useMemo(() => {
    if (!jobs || !search) return [];
    const q = search.toLowerCase();
    return jobs.filter((j) => j.name.toLowerCase().includes(q)).slice(0, 5);
  }, [jobs, search]);

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  if (!open) return null;

  const itemClass =
    "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent";
  const groupHeadingClass =
    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh] sm:pt-[20vh]"
      onClick={() => onOpenChange(false)}
    >
      <div className="fixed inset-0 bg-black/50" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <Command className="flex flex-col" shouldFilter={false}>
          <div className="flex items-center border-b border-border px-3">
            <IconSearch className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
            <Command.Input
              placeholder="Search candidates, jobs, or navigate..."
              autoFocus
              value={search}
              onValueChange={setSearch}
              className="flex-1 bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {search && candidatesLoading && (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Searching candidates…
              </div>
            )}

            {/* Candidate results */}
            {search && candidates && candidates.length > 0 && (
              <Command.Group heading="Candidates" className={groupHeadingClass}>
                {candidates.slice(0, 8).map((c) => (
                  <Command.Item
                    key={`candidate-${c.id}`}
                    value={`candidate ${c.first_name} ${c.last_name} ${c.company || ""}`}
                    onSelect={() => go(`/candidates/${c.id}`)}
                    className={itemClass}
                  >
                    <IconUser className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">
                        {c.first_name} {c.last_name}
                      </span>
                      {(c.title || c.company) && (
                        <span className="text-xs text-muted-foreground truncate">
                          {[c.title, c.company].filter(Boolean).join(" at ")}
                        </span>
                      )}
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Job results */}
            {search && filteredJobs.length > 0 && (
              <Command.Group heading="Jobs" className={groupHeadingClass}>
                {filteredJobs.map((j) => (
                  <Command.Item
                    key={`job-${j.id}`}
                    value={`job ${j.name}`}
                    onSelect={() => go(`/jobs/${j.id}`)}
                    className={itemClass}
                  >
                    <IconBriefcase className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{j.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Navigation */}
            <Command.Group heading="Navigation" className={groupHeadingClass}>
              <Command.Item
                value="dashboard"
                onSelect={() => go("/dashboard")}
                className={itemClass}
              >
                <IconLayoutDashboard className="h-4 w-4 text-muted-foreground" />
                Dashboard
                <span className="ml-auto text-xs text-muted-foreground">
                  G D
                </span>
              </Command.Item>
              <Command.Item
                value="jobs"
                onSelect={() => go("/jobs")}
                className={itemClass}
              >
                <IconBriefcase className="h-4 w-4 text-muted-foreground" />
                Jobs
                <span className="ml-auto text-xs text-muted-foreground">
                  G J
                </span>
              </Command.Item>
              <Command.Item
                value="candidates"
                onSelect={() => go("/candidates")}
                className={itemClass}
              >
                <IconUsers className="h-4 w-4 text-muted-foreground" />
                Candidates
                <span className="ml-auto text-xs text-muted-foreground">
                  G C
                </span>
              </Command.Item>
              <Command.Item
                value="interviews"
                onSelect={() => go("/interviews")}
                className={itemClass}
              >
                <IconCalendar className="h-4 w-4 text-muted-foreground" />
                Interviews
                <span className="ml-auto text-xs text-muted-foreground">
                  G I
                </span>
              </Command.Item>
              <Command.Item
                value="settings"
                onSelect={() => go("/settings")}
                className={itemClass}
              >
                <IconSettings className="h-4 w-4 text-muted-foreground" />
                Settings
                <span className="ml-auto text-xs text-muted-foreground">
                  G S
                </span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
