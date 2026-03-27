import { useNavigate } from "react-router";
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  Trash2,
  Search,
  PenLine,
  Moon,
  Sun,
  RefreshCw,
  CornerUpLeft,
  ShieldAlert,
  Ban,
  BellOff,
  ImageOff,
  Image,
  Eye,
  AlarmClock,
} from "lucide-react";
import { CommandMenu } from "@agent-native/core/client";
import { useTheme } from "next-themes";
import { useSettings, useUpdateSettings } from "@/hooks/use-emails";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompose: () => void;
  onReply?: () => void;
  onSnooze?: () => void;
  onSpam?: () => void;
  onBlockSender?: () => void;
  onMuteThread?: () => void;
  /** Whether there is a focused/selected email for contextual actions */
  hasEmail?: boolean;
}

const navCommands = [
  { label: "Go to Inbox", icon: Inbox, route: "/inbox", shortcut: "G I" },
  { label: "Go to Starred", icon: Star, route: "/starred", shortcut: "G S" },
  { label: "Go to Sent", icon: Send, route: "/sent", shortcut: "G T" },
  { label: "Go to Drafts", icon: FileText, route: "/drafts", shortcut: "G D" },
  { label: "Go to Archive", icon: Archive, route: "/archive", shortcut: "G A" },
  { label: "Go to Trash", icon: Trash2, route: "/trash" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onCompose,
  onReply,
  onSnooze,
  onSpam,
  onBlockSender,
  onMuteThread,
  hasEmail,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const imagePolicy = settings?.imagePolicy ?? "show";

  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Type a command or ask AI..."
    >
      <CommandMenu.Group heading="Actions">
        <CommandMenu.Item
          onSelect={onCompose}
          keywords={["compose", "new", "write"]}
        >
          <PenLine className="h-4 w-4" />
          Compose new email
          <CommandMenu.Shortcut>C</CommandMenu.Shortcut>
        </CommandMenu.Item>
        {onReply && (
          <CommandMenu.Item onSelect={onReply} keywords={["reply", "respond"]}>
            <CornerUpLeft className="h-4 w-4" />
            Reply to thread
            <CommandMenu.Shortcut>R</CommandMenu.Shortcut>
          </CommandMenu.Item>
        )}
        {onSnooze && (
          <CommandMenu.Item
            onSelect={onSnooze}
            keywords={["snooze", "later", "remind"]}
          >
            <AlarmClock className="h-4 w-4" />
            Snooze email
            <CommandMenu.Shortcut>H</CommandMenu.Shortcut>
          </CommandMenu.Item>
        )}
        <CommandMenu.Item
          onSelect={() => navigate(`/inbox?q=`)}
          keywords={["search", "find"]}
        >
          <Search className="h-4 w-4" />
          Search emails
          <CommandMenu.Shortcut>/</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => window.location.reload()}
          keywords={["refresh", "reload"]}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh inbox
        </CommandMenu.Item>
        {onSpam && (
          <CommandMenu.Item onSelect={onSpam} keywords={["spam", "junk"]}>
            <ShieldAlert className="h-4 w-4" />
            Report spam
          </CommandMenu.Item>
        )}
        {onBlockSender && (
          <CommandMenu.Item
            onSelect={onBlockSender}
            keywords={["block", "spam"]}
          >
            <Ban className="h-4 w-4" />
            Report spam & block sender
          </CommandMenu.Item>
        )}
        {onMuteThread && (
          <CommandMenu.Item
            onSelect={onMuteThread}
            keywords={["mute", "silence"]}
          >
            <BellOff className="h-4 w-4" />
            Mute thread
          </CommandMenu.Item>
        )}
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading="Navigate">
        {navCommands.map((cmd) => (
          <CommandMenu.Item
            key={cmd.route}
            onSelect={() => navigate(cmd.route)}
            keywords={[cmd.label.toLowerCase()]}
          >
            <cmd.icon className="h-4 w-4" />
            {cmd.label}
            {cmd.shortcut && (
              <CommandMenu.Shortcut>{cmd.shortcut}</CommandMenu.Shortcut>
            )}
          </CommandMenu.Item>
        ))}
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading="Privacy">
        <CommandMenu.Item
          onSelect={() => updateSettings.mutate({ imagePolicy: "show" })}
          keywords={["images", "show"]}
        >
          <Image className="h-4 w-4" />
          Images: Show all
          {imagePolicy === "show" && (
            <CommandMenu.Shortcut>✓</CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() =>
            updateSettings.mutate({ imagePolicy: "block-trackers" })
          }
          keywords={["images", "trackers", "privacy"]}
        >
          <Eye className="h-4 w-4" />
          Images: Block known trackers
          {imagePolicy === "block-trackers" && (
            <CommandMenu.Shortcut>✓</CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => updateSettings.mutate({ imagePolicy: "block-all" })}
          keywords={["images", "block", "privacy"]}
        >
          <ImageOff className="h-4 w-4" />
          Images: Block all remote images
          {imagePolicy === "block-all" && (
            <CommandMenu.Shortcut>✓</CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading="Appearance">
        <CommandMenu.Item
          onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
          keywords={["theme", "dark", "light", "mode"]}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          Toggle {theme === "dark" ? "light" : "dark"} mode
        </CommandMenu.Item>
      </CommandMenu.Group>
    </CommandMenu>
  );
}
