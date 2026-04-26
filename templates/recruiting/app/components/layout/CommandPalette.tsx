import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconSettings,
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

  const filteredJobs = useMemo(() => {
    if (!jobs || !search) return [];
    const q = search.toLowerCase();
    return jobs.filter((j) => j.name.toLowerCase().includes(q)).slice(0, 5);
  }, [jobs, search]);

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search candidates, jobs, or navigate..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {search && candidatesLoading && (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            Searching candidates…
          </div>
        )}

        {/* Candidate results */}
        {search && candidates && candidates.length > 0 && (
          <CommandGroup heading="Candidates">
            {candidates.slice(0, 8).map((c) => (
              <CommandItem
                key={`candidate-${c.id}`}
                value={`candidate ${c.first_name} ${c.last_name} ${c.company || ""}`}
                onSelect={() => go(`/candidates/${c.id}`)}
              >
                <IconUser className="mr-2 h-4 w-4 text-muted-foreground" />
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
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Job results */}
        {search && filteredJobs.length > 0 && (
          <CommandGroup heading="Jobs">
            {filteredJobs.map((j) => (
              <CommandItem
                key={`job-${j.id}`}
                value={`job ${j.name}`}
                onSelect={() => go(`/jobs/${j.id}`)}
              >
                <IconBriefcase className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="truncate">{j.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem value="dashboard" onSelect={() => go("/dashboard")}>
            <IconLayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
            Dashboard
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem value="jobs" onSelect={() => go("/jobs")}>
            <IconBriefcase className="mr-2 h-4 w-4 text-muted-foreground" />
            Jobs
            <CommandShortcut>G J</CommandShortcut>
          </CommandItem>
          <CommandItem value="candidates" onSelect={() => go("/candidates")}>
            <IconUsers className="mr-2 h-4 w-4 text-muted-foreground" />
            Candidates
            <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem value="interviews" onSelect={() => go("/interviews")}>
            <IconCalendar className="mr-2 h-4 w-4 text-muted-foreground" />
            Interviews
            <CommandShortcut>G I</CommandShortcut>
          </CommandItem>
          <CommandItem value="settings" onSelect={() => go("/settings")}>
            <IconSettings className="mr-2 h-4 w-4 text-muted-foreground" />
            Settings
            <CommandShortcut>G S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
