import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Trash2,
  Search,
  PenLine,
  Settings,
  Moon,
  Sun,
  RefreshCw,
  CornerUpLeft,
  Tag,
  Keyboard,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "next-themes";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompose: () => void;
  onReply?: () => void;
}

const navCommands = [
  { label: "Go to Inbox", icon: Inbox, route: "/inbox", shortcut: "G I" },
  { label: "Go to Starred", icon: Star, route: "/starred", shortcut: "G S" },
  { label: "Go to Sent", icon: Send, route: "/sent", shortcut: "G T" },
  { label: "Go to Drafts", icon: FileText, route: "/drafts", shortcut: "G D" },
  { label: "Go to Archive", icon: Archive, route: "/archive", shortcut: "G A" },
  { label: "Go to Trash", icon: Trash2, route: "/trash" },
  { label: "Settings", icon: Settings, route: "/settings" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onCompose,
  onReply,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const run = useCallback(
    (fn: () => void) => {
      onOpenChange(false);
      setTimeout(fn, 50);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onCompose)}>
            <PenLine className="mr-2 h-4 w-4" />
            Compose new email
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          {onReply && (
            <CommandItem onSelect={() => run(onReply)}>
              <CornerUpLeft className="mr-2 h-4 w-4" />
              Reply to thread
              <CommandShortcut>R</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem onSelect={() => run(() => navigate(`/inbox?q=`))}>
            <Search className="mr-2 h-4 w-4" />
            Search emails
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => window.location.reload())}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh inbox
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {navCommands.map((cmd) => (
            <CommandItem
              key={cmd.route}
              onSelect={() => run(() => navigate(cmd.route))}
            >
              <cmd.icon className="mr-2 h-4 w-4" />
              {cmd.label}
              {cmd.shortcut && (
                <CommandShortcut>{cmd.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Appearance">
          <CommandItem
            onSelect={() =>
              run(() => setTheme(theme === "dark" ? "light" : "dark"))
            }
          >
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Toggle {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
