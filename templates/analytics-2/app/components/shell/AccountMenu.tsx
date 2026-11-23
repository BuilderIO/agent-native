import { useT } from "@agent-native/core/client/i18n";
import {
  IconActivity,
  IconBook,
  IconCopy,
  IconDots,
  IconHistory,
  IconMail,
  IconPalette,
} from "@tabler/icons-react";

import messages from "@/i18n/en-US";

import { Popover } from "./Popover";
import {
  Avatar,
  MenuButton,
  MenuDivider,
  MenuExternalLink,
  MenuHeading,
  SubmenuMenuButton,
} from "./primitives";
import { ThemeMenuItems } from "./ThemeMenuItems";
import type { WorkspaceShellAccountMenu, WorkspaceShellUser } from "./types";

const DOCUMENTATION_URL = "https://www.agent-native.com/docs/";
const CHANGELOG_URL = "https://github.com/BuilderIO/agent-native/releases";
const STATUS_URL = "https://status.builder.io/";
const SUPPORT_URL = "mailto:support@builder.io";

export function AccountMenu({
  user,
  accountMenu,
}: {
  user: WorkspaceShellUser;
  accountMenu?: WorkspaceShellAccountMenu | undefined;
}) {
  const t = useT();
  const displayName = user.name || user.email || "Account";
  return (
    <Popover
      label="Account menu"
      role="menu"
      placement="top-start"
      minWidth={270}
      allowOverflow={true}
      trigger={(triggerProps) => (
        <button
          type="button"
          className="ws-account-button"
          aria-label={`${displayName} account menu`}
          {...triggerProps}
        >
          <Avatar
            name={user.name}
            email={user.email}
            avatarUrl={user.avatarUrl}
          />
          <span className="ws-account-name">{displayName}</span>
          <IconDots size={16} aria-hidden="true" />
        </button>
      )}
    >
      <div className="ws-menu">
        <SubmenuMenuButton
          icon={<IconPalette size={16} />}
          label={t("analytics.shell.theme", {
            defaultValue: messages.analytics.shell.theme,
          })}
        >
          <ThemeMenuItems />
        </SubmenuMenuButton>
        <MenuHeading>Help</MenuHeading>
        <MenuExternalLink
          icon={<IconBook size={16} />}
          label={t("analytics.shell.documentation", {
            defaultValue: messages.analytics.shell.documentation,
          })}
          href={DOCUMENTATION_URL}
        />
        <MenuExternalLink
          icon={<IconHistory size={16} />}
          label={t("analytics.shell.changelog", {
            defaultValue: messages.analytics.shell.changelog,
          })}
          href={CHANGELOG_URL}
        />
        <MenuExternalLink
          icon={<IconActivity size={16} />}
          label={t("analytics.shell.statusPage", {
            defaultValue: messages.analytics.shell.statusPage,
          })}
          href={STATUS_URL}
        />
        <MenuDivider />
        <MenuExternalLink
          icon={<IconMail size={16} />}
          label={t("analytics.shell.emailSupport", {
            defaultValue: messages.analytics.shell.emailSupport,
          })}
          href={SUPPORT_URL}
        />
        <MenuButton
          icon={<IconCopy size={16} />}
          label={t("analytics.shell.copyDebugInfo", {
            defaultValue: messages.analytics.shell.copyDebugInfo,
          })}
          disabled={!accountMenu?.onCopyDebugInfo}
          title={
            accountMenu?.onCopyDebugInfo
              ? undefined
              : t("analytics.shell.copyDebugInfoUnavailable", {
                  defaultValue:
                    messages.analytics.shell.copyDebugInfoUnavailable,
                })
          }
          onSelect={() => void accountMenu?.onCopyDebugInfo?.()}
        />
      </div>
    </Popover>
  );
}
