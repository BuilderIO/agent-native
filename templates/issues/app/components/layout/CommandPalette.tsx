import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  IconCircleDot,
  IconFolder,
  IconSettings,
  IconSearch,
} from "@tabler/icons-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search issues, navigate..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => navigate("/my-issues"))}
          >
            <IconCircleDot className="mr-2 h-4 w-4" />
            My Issues
            <span className="ml-auto text-[11px] text-muted-foreground">
              G I
            </span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/projects"))}>
            <IconFolder className="mr-2 h-4 w-4" />
            Projects
            <span className="ml-auto text-[11px] text-muted-foreground">
              G P
            </span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/settings"))}>
            <IconSettings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        {search && (
          <CommandGroup heading="Search">
            <CommandItem
              onSelect={() =>
                runCommand(() =>
                  navigate(`/my-issues?q=${encodeURIComponent(search)}`),
                )
              }
            >
              <IconSearch className="mr-2 h-4 w-4" />
              Search issues for &ldquo;{search}&rdquo;
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
