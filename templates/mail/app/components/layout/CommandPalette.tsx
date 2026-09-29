import { useT } from "@agent-native/core/client/i18n";
import { CommandMenu } from "@agent-native/core/client/navigation";
import {
  IconHierarchy2,
  IconInbox,
  IconMail,
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
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useSettings, useUpdateSettings } from "@/hooks/use-emails";
import { getNextTheme, getResolvedTheme } from "@/lib/theme";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onCompose: () => void;
  onSearch: () => void;
  onReply?: () => void;
  onSnooze?: () => void;
  onSpam?: () => void;
  onBlockSender?: () => void;
  onMuteThread?: () => void;
  onSend?: () => void;
  onSendLater?: () => void;
  onSendAndMarkDone?: () => void;
  isComposeContext?: boolean;
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
    labelKey: "commandPalette.goToAllMail",
    icon: IconMail,
    route: "/all",
    shortcut: "G A",
  },
  {
    labelKey: "commandPalette.goToArchive",
    icon: IconArchive,
    route: "/archive",
    shortcut: "G E",
  },
  { labelKey: "commandPalette.goToTrash", icon: IconTrash, route: "/trash" },
  {
    labelKey: "settings.openAgentSettings",
    icon: IconHierarchy2,
    route: "/settings/agent",
  },
];

const composeShortcutLabels = {
  send: "⌘ Enter / Ctrl Enter",
  sendLater: "⌘ Shift L / Ctrl Shift L",
  sendAndMarkDone: "⌘ Shift Enter / Ctrl Shift Enter",
};

export function CommandPalette({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onCompose,
  onSearch,
  onReply,
  onSnooze,
  onSpam,
  onBlockSender,
  onMuteThread,
  onSend,
  onSendLater,
  onSendAndMarkDone,
  isComposeContext = false,
  hasEmail,
}: CommandPaletteProps) {
  const t = useT();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const isDark = getResolvedTheme(resolvedTheme) === "dark";
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const imagePolicy = settings?.imagePolicy ?? "show";
  const autocompleteEnabled = settings?.autocompleteEnabled ?? false;
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [changelog, setChangelog] = useState<string>();
  const keepPaletteOpenRef = useRef(false);

  useEffect(() => {
    if (!open || changelog !== undefined) return;
    void import("../../../CHANGELOG.md?raw")
      .then(({ default: markdown }) => {
        setChangelog(markdown);
      })
      .catch(() => undefined);
  }, [open, changelog]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && keepPaletteOpenRef.current) {
      keepPaletteOpenRef.current = false;
      return;
    }
    if (!nextOpen) setShowShortcuts(false);
    onOpenChange(nextOpen);
  };

  const shortcutGroups = [
    {
      heading: t("commandPalette.shortcutsGlobal"),
      entries: [
        [t("commandPalette.compose"), "C"],
        [t("commandPalette.search"), "/"],
        [t("commandPalette.shortcuts"), "⌘ K / Ctrl K"],
        [t("mail.actions.undo"), "Z"],
        [t("commandPalette.snooze"), "H"],
        [t("commandPalette.reportSpam"), "Shift+1"],
        [t("commandPalette.cycleTabs"), "Tab / Shift+Tab"],
        [t("commandPalette.goToInbox"), "G I"],
        [t("commandPalette.goToStarred"), "G S"],
        [t("commandPalette.goToSent"), "G T"],
        [t("commandPalette.goToDrafts"), "G D"],
        [t("commandPalette.goToAllMail"), "G A"],
        [t("commandPalette.goToArchive"), "G E"],
        [t("commandPalette.goToTrash"), "G #"],
      ],
    },
    {
      heading: t("commandPalette.shortcutsList"),
      entries: [
        [t("commandPalette.moveSelection"), "J / ↓ · K / ↑"],
        [t("commandPalette.extendSelection"), "Shift+J/K · Shift+↑/↓"],
        [t("commandPalette.selectAllConversations"), "⌘ A / Ctrl A"],
        [t("commandPalette.openMessage"), "Enter / O"],
        [t("mail.actions.archive"), "E"],
        [t("mail.actions.moveToTrash"), "D / #"],
        [t("commandPalette.toggleReadState"), "U"],
        [t("mail.actions.markRead"), "Shift I"],
        [t("mail.actions.markUnread"), "Shift U"],
        [t("mail.mobileActions.star"), "S"],
        [t("commandPalette.reply"), "R"],
        [t("mail.compose.forward"), "F"],
        [t("mail.mobileActions.replyAll"), "A"],
      ],
    },
    {
      heading: t("commandPalette.shortcutsThread"),
      entries: [
        [t("commandPalette.nextPreviousConversation"), "J / K"],
        [t("commandPalette.nextPreviousMessage"), "N / P"],
        [t("commandPalette.toggleMessageExpansion"), "Enter / O"],
        [t("mail.actions.archive"), "E"],
        [t("mail.actions.moveToTrash"), "D / #"],
        [t("commandPalette.toggleReadState"), "U"],
        [t("mail.actions.markRead"), "Shift+I"],
        [t("mail.actions.markUnread"), "Shift+U"],
        [t("mail.mobileActions.star"), "S"],
        [t("commandPalette.reply"), "R"],
        [t("mail.mobileActions.replyAll"), "A"],
        [t("mail.compose.forward"), "F"],
        [t("mail.thread.searchConversation"), "⌘ F / Ctrl F"],
        [t("commandPalette.backToMessageList"), "Esc"],
      ],
    },
    {
      heading: t("commandPalette.shortcutsCompose"),
      entries: [
        [t("mail.compose.send"), composeShortcutLabels.send],
        [t("mail.sendLater.scheduleSend"), composeShortcutLabels.sendLater],
        [
          t("commandPalette.sendAndMarkDone"),
          composeShortcutLabels.sendAndMarkDone,
        ],
        [t("mail.draftQueue.bcc"), "⌘ Shift B / Ctrl Shift B"],
        [t("mail.mobileActions.close"), "Esc"],
      ],
    },
  ];

  return (
    <CommandMenu
      open={open}
      onOpenChange={handleOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      clearSearchOnEscape
      placeholder={t("commandPalette.placeholder")}
      changelog={changelog}
      changelogKey="mail"
    >
      {showShortcuts && (
        <CommandMenu.Group heading={t("commandPalette.shortcuts")}>
          <CommandMenu.Item
            deferSelect={false}
            onSelect={() => {
              keepPaletteOpenRef.current = true;
              setShowShortcuts(false);
            }}
            keywords={["back", "commands", "shortcuts"]}
          >
            {t("commandPalette.backToCommands")}
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}
      {showShortcuts &&
        shortcutGroups.map((group) => (
          <CommandMenu.Group key={group.heading} heading={group.heading}>
            <div className="px-2 pb-2">
              {group.entries.map(([label, shortcut]) => (
                <div
                  key={`${label}-${shortcut}`}
                  className="flex min-h-8 items-center justify-between gap-4 text-sm"
                >
                  <span className="truncate">{label}</span>
                  <kbd className="shrink-0 font-mono text-xs text-muted-foreground">
                    {shortcut}
                  </kbd>
                </div>
              ))}
            </div>
          </CommandMenu.Group>
        ))}
      {!showShortcuts && (
        <CommandMenu.Group heading={t("commandPalette.actions")}>
          {isComposeContext && onSend && (
            <CommandMenu.Item
              onSelect={onSend}
              keywords={[
                t("mail.compose.send").toLowerCase(),
                "send",
                "send email",
              ]}
            >
              <IconSend className="h-4 w-4" />
              {t("mail.compose.send")}
              <CommandMenu.Shortcut>
                {composeShortcutLabels.send}
              </CommandMenu.Shortcut>
            </CommandMenu.Item>
          )}
          {isComposeContext && onSendLater && (
            <CommandMenu.Item
              onSelect={onSendLater}
              keywords={[
                t("mail.sendLater.scheduleSend").toLowerCase(),
                "send later",
                "schedule",
              ]}
            >
              <IconAlarm className="h-4 w-4" />
              {t("mail.sendLater.scheduleSend")}
              <CommandMenu.Shortcut>
                {composeShortcutLabels.sendLater}
              </CommandMenu.Shortcut>
            </CommandMenu.Item>
          )}
          {isComposeContext && onSendAndMarkDone && (
            <CommandMenu.Item
              onSelect={onSendAndMarkDone}
              keywords={[
                t("commandPalette.sendAndMarkDone").toLowerCase(),
                "send and mark done",
                "send done",
              ]}
            >
              <IconCheck className="h-4 w-4" />
              {t("commandPalette.sendAndMarkDone")}
              <CommandMenu.Shortcut>
                {composeShortcutLabels.sendAndMarkDone}
              </CommandMenu.Shortcut>
            </CommandMenu.Item>
          )}
          <CommandMenu.Item
            onSelect={onCompose}
            keywords={["compose", "new", "write"]}
          >
            <IconPencil className="h-4 w-4" />
            {t("commandPalette.compose")}
            <CommandMenu.Shortcut>C</CommandMenu.Shortcut>
          </CommandMenu.Item>
          {!settingsLoading && settings && (
            <CommandMenu.Item
              onSelect={() => {
                if (updateSettings.isPending) return;
                updateSettings.mutate(
                  {
                    autocompleteEnabled: !autocompleteEnabled,
                  },
                  {
                    onError: (error) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("settings.autocompleteSaveFailed"),
                      ),
                  },
                );
              }}
              keywords={[
                "autocomplete",
                "completion",
                "writing",
                "suggestions",
              ]}
            >
              <IconPencil className="h-4 w-4" />
              {t(
                autocompleteEnabled
                  ? "commandPalette.disableAutocomplete"
                  : "commandPalette.enableAutocomplete",
              )}
            </CommandMenu.Item>
          )}
          {!isComposeContext && onReply && (
            <CommandMenu.Item
              onSelect={onReply}
              keywords={["reply", "respond"]}
            >
              <IconCornerUpLeft className="h-4 w-4 rtl:-scale-x-100" />
              {t("commandPalette.reply")}
              <CommandMenu.Shortcut>R</CommandMenu.Shortcut>
            </CommandMenu.Item>
          )}
          {!isComposeContext && onSnooze && (
            <CommandMenu.Item
              onSelect={onSnooze}
              keywords={["snooze", "later", "remind"]}
            >
              <IconAlarm className="h-4 w-4" />
              {t("commandPalette.snooze")}
              <CommandMenu.Shortcut>H</CommandMenu.Shortcut>
            </CommandMenu.Item>
          )}
          <CommandMenu.Item onSelect={onSearch} keywords={["search", "find"]}>
            <IconSearch className="h-4 w-4" />
            {t("commandPalette.search")}
            <CommandMenu.Shortcut>/</CommandMenu.Shortcut>
          </CommandMenu.Item>
          <CommandMenu.Item
            deferSelect={false}
            onSelect={() => {
              keepPaletteOpenRef.current = true;
              setShowShortcuts(true);
            }}
            keywords={["shortcuts", "keyboard", "keys"]}
          >
            {t("commandPalette.shortcuts")}
          </CommandMenu.Item>
          <CommandMenu.Item
            onSelect={() => window.location.reload()}
            keywords={["refresh", "reload"]}
          >
            <IconRefresh className="h-4 w-4" />
            {t("commandPalette.refresh")}
          </CommandMenu.Item>
          {!isComposeContext && onSpam && (
            <CommandMenu.Item onSelect={onSpam} keywords={["spam", "junk"]}>
              <IconShieldExclamation className="h-4 w-4" />
              {t("commandPalette.reportSpam")}
            </CommandMenu.Item>
          )}
          {!isComposeContext && onBlockSender && (
            <CommandMenu.Item
              onSelect={onBlockSender}
              keywords={["block", "spam"]}
            >
              <IconBan className="h-4 w-4" />
              {t("commandPalette.reportSpamBlock")}
            </CommandMenu.Item>
          )}
          {!isComposeContext && onMuteThread && (
            <CommandMenu.Item
              onSelect={onMuteThread}
              keywords={["mute", "silence"]}
            >
              <IconBellOff className="h-4 w-4" />
              {t("commandPalette.muteThread")}
            </CommandMenu.Item>
          )}
        </CommandMenu.Group>
      )}
      {!showShortcuts && <CommandMenu.Separator />}
      {!showShortcuts && (
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
      )}
      {!showShortcuts && <CommandMenu.Separator />}
      {!showShortcuts && (
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
      )}
      {!showShortcuts && <CommandMenu.Separator />}
      {!showShortcuts && (
        <CommandMenu.Group heading={t("commandPalette.appearance")}>
          <CommandMenu.Item
            onSelect={() => setTheme(getNextTheme(theme, resolvedTheme))}
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
      )}
    </CommandMenu>
  );
}
