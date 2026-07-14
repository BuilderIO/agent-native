import { CommandMenu, useT } from "@agent-native/core/client";
import {
  IconBrain,
  IconInbox,
  IconStar,
  IconSend,
  IconFileText,
  IconArchive,
  IconTrash,
  IconSearch,
  IconPencil,
  IconMoon,
  IconSun,
  IconRefresh,
  IconCornerUpLeft,
  IconShieldExclamation,
  IconBan,
  IconBellOff,
  IconPhotoOff,
  IconPhoto,
  IconEye,
  IconAlarm,
  IconCheck,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router";

import { useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { getResolvedTheme } from "@/lib/theme";

import changelog from "../../../CHANGELOG.md?raw";

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
  {
    labelKey: "commandPalette.goToInbox",
    icon: IconInbox,
    route: "/inbox",
    shortcut: "G I",
  },
  {
    labelKey: "commandPalette.goToStarred",
    icon: IconStar,
    route: "/starred",
    shortcut: "G S",
  },
  {
    labelKey: "commandPalette.goToSent",
    icon: IconSend,
    route: "/sent",
    shortcut: "G T",
  },
  {
    labelKey: "commandPalette.goToDrafts",
    icon: IconFileText,
    route: "/drafts",
    shortcut: "G D",
  },
  {
    labelKey: "commandPalette.goToArchive",
    icon: IconArchive,
    route: "/archive",
    shortcut: "G A",
  },
  { labelKey: "commandPalette.goToTrash", icon: IconTrash, route: "/trash" },
  {
    labelKey: "settings.openAgentSettings",
    icon: IconBrain,
    route: "/agent",
  },
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
  const t = useT();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = getResolvedTheme(resolvedTheme) === "dark";
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const imagePolicy = settings?.imagePolicy ?? "show";

  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      placeholder={t("commandPalette.placeholder")}
      changelog={changelog}
      changelogKey="mail"
    >
      <CommandMenu.Group heading={t("commandPalette.actions")}>
        <CommandMenu.Item
          onSelect={onCompose}
          keywords={["compose", "new", "write"]}
        >
          <IconPencil className="h-4 w-4" />
          {t("commandPalette.compose")}
          <CommandMenu.Shortcut>C</CommandMenu.Shortcut>
        </CommandMenu.Item>
        {onReply && (
          <CommandMenu.Item onSelect={onReply} keywords={["reply", "respond"]}>
            <IconCornerUpLeft className="h-4 w-4 rtl:-scale-x-100" />
            {t("commandPalette.reply")}
            <CommandMenu.Shortcut>R</CommandMenu.Shortcut>
          </CommandMenu.Item>
        )}
        {onSnooze && (
          <CommandMenu.Item
            onSelect={onSnooze}
            keywords={["snooze", "later", "remind"]}
          >
            <IconAlarm className="h-4 w-4" />
            {t("commandPalette.snooze")}
            <CommandMenu.Shortcut>H</CommandMenu.Shortcut>
          </CommandMenu.Item>
        )}
        <CommandMenu.Item
          onSelect={() => navigate(`/all?q=`)}
          keywords={["search", "find"]}
        >
          <IconSearch className="h-4 w-4" />
          {t("commandPalette.search")}
          <CommandMenu.Shortcut>/</CommandMenu.Shortcut>
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => window.location.reload()}
          keywords={["refresh", "reload"]}
        >
          <IconRefresh className="h-4 w-4" />
          {t("commandPalette.refresh")}
        </CommandMenu.Item>
        {onSpam && (
          <CommandMenu.Item onSelect={onSpam} keywords={["spam", "junk"]}>
            <IconShieldExclamation className="h-4 w-4" />
            {t("commandPalette.reportSpam")}
          </CommandMenu.Item>
        )}
        {onBlockSender && (
          <CommandMenu.Item
            onSelect={onBlockSender}
            keywords={["block", "spam"]}
          >
            <IconBan className="h-4 w-4" />
            {t("commandPalette.reportSpamBlock")}
          </CommandMenu.Item>
        )}
        {onMuteThread && (
          <CommandMenu.Item
            onSelect={onMuteThread}
            keywords={["mute", "silence"]}
          >
            <IconBellOff className="h-4 w-4" />
            {t("commandPalette.muteThread")}
          </CommandMenu.Item>
        )}
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading={t("commandPalette.navigate")}>
        {navCommands.map((cmd) => (
          <CommandMenu.Item
            key={cmd.route}
            onSelect={() => navigate(cmd.route)}
            keywords={[t(cmd.labelKey).toLowerCase()]}
          >
            <cmd.icon className="h-4 w-4" />
            {t(cmd.labelKey)}
            {cmd.shortcut && (
              <CommandMenu.Shortcut>{cmd.shortcut}</CommandMenu.Shortcut>
            )}
          </CommandMenu.Item>
        ))}
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading={t("commandPalette.privacy")}>
        <CommandMenu.Item
          onSelect={() => updateSettings.mutate({ imagePolicy: "show" })}
          keywords={["images", "show"]}
        >
          <IconPhoto className="h-4 w-4" />
          {t("commandPalette.imagesShowAll")}
          {imagePolicy === "show" && (
            <CommandMenu.Shortcut>
              <IconCheck className="h-4 w-4" />
            </CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() =>
            updateSettings.mutate({ imagePolicy: "block-trackers" })
          }
          keywords={["images", "trackers", "privacy"]}
        >
          <IconEye className="h-4 w-4" />
          {t("commandPalette.imagesBlockTrackers")}
          {imagePolicy === "block-trackers" && (
            <CommandMenu.Shortcut>
              <IconCheck className="h-4 w-4" />
            </CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
        <CommandMenu.Item
          onSelect={() => updateSettings.mutate({ imagePolicy: "block-all" })}
          keywords={["images", "block", "privacy"]}
        >
          <IconPhotoOff className="h-4 w-4" />
          {t("commandPalette.imagesBlockAll")}
          {imagePolicy === "block-all" && (
            <CommandMenu.Shortcut>
              <IconCheck className="h-4 w-4" />
            </CommandMenu.Shortcut>
          )}
        </CommandMenu.Item>
      </CommandMenu.Group>

      <CommandMenu.Separator />

      <CommandMenu.Group heading={t("commandPalette.appearance")}>
        <CommandMenu.Item
          onSelect={() =>
            setTheme(
              getResolvedTheme(resolvedTheme) === "dark" ? "light" : "dark",
            )
          }
          keywords={["theme", "dark", "light", "mode"]}
        >
          {isDark ? (
            <IconSun className="h-4 w-4" />
          ) : (
            <IconMoon className="h-4 w-4" />
          )}
          {isDark
            ? t("commandPalette.toggleLight")
            : t("commandPalette.toggleDark")}
        </CommandMenu.Item>
      </CommandMenu.Group>
    </CommandMenu>
  );
}
