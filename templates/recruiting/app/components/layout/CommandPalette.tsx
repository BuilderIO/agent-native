import { useNavigate } from "react-router";
import { Command } from "cmdk";
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconUsers,
  IconCalendar,
  IconSettings,
} from "@tabler/icons-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => onOpenChange(false)}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Dialog */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      >
        <Command className="flex flex-col">
          <div className="flex items-center border-b border-border px-3">
            <Command.Input
              placeholder="Type a command or search..."
              autoFocus
              className="flex-1 bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1.5">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            <Command.Group
              heading="Navigation"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
            >
              <Command.Item
                onSelect={() => go("/dashboard")}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent"
              >
                <IconLayoutDashboard className="h-4 w-4 text-muted-foreground" />
                Dashboard
                <span className="ml-auto text-xs text-muted-foreground">
                  G D
                </span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/jobs")}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent"
              >
                <IconBriefcase className="h-4 w-4 text-muted-foreground" />
                Jobs
                <span className="ml-auto text-xs text-muted-foreground">
                  G J
                </span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/candidates")}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent"
              >
                <IconUsers className="h-4 w-4 text-muted-foreground" />
                Candidates
                <span className="ml-auto text-xs text-muted-foreground">
                  G C
                </span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/interviews")}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent"
              >
                <IconCalendar className="h-4 w-4 text-muted-foreground" />
                Interviews
                <span className="ml-auto text-xs text-muted-foreground">
                  G I
                </span>
              </Command.Item>
              <Command.Item
                onSelect={() => go("/settings")}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-accent"
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
