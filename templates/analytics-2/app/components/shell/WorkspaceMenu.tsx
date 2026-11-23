import {
  IconAdjustments,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconLogin,
  IconLogout,
  IconPlus,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";

import { Popover } from "./Popover";
import {
  MenuButton,
  MenuDivider,
  MenuLink,
  SubmenuMenuButton,
} from "./primitives";
import { ThemeMenuItems } from "./ThemeMenuItems";
import type {
  WorkspaceShellWorkspace,
  WorkspaceShellWorkspaceEntry,
  WorkspaceShellWorkspaceMenu,
} from "./types";

function workspaceSubtitle(entry: WorkspaceShellWorkspaceEntry) {
  const parts: Array<string | number> = [];
  if (entry.memberCount && entry.memberCount > 0) {
    parts.push(
      `${entry.memberCount} ${entry.memberCount === 1 ? "member" : "members"}`,
    );
  }
  if (entry.role) parts.push(entry.role);
  return parts;
}

export function WorkspaceMenu({
  workspace,
  workspaceMenu,
  onNavigate,
}: {
  workspace: WorkspaceShellWorkspace;
  workspaceMenu?: WorkspaceShellWorkspaceMenu | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const [search, setSearch] = useState("");
  const entries: readonly WorkspaceShellWorkspaceEntry[] =
    workspaceMenu?.workspaces && workspaceMenu.workspaces.length > 0
      ? workspaceMenu.workspaces
      : [{ id: workspace.id, name: workspace.name }];
  const filteredEntries = search.trim()
    ? entries.filter((entry) =>
        entry.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : entries;
  const authedCount = entries.filter((entry) => !entry.needsLogin).length;
  const logoutLabel =
    authedCount > 1 ? `Log out of ${workspace.name}` : "Log out";
  const platformAdmin = workspaceMenu?.isPlatformAdmin === true;

  return (
    <Popover
      label={`${workspace.name} menu`}
      role="menu"
      minWidth={243}
      allowOverflow={true}
      trigger={(triggerProps) => (
        <button
          type="button"
          className="ws-workspace-trigger"
          {...triggerProps}
        >
          <span className="ws-workspace-name">{workspace.name}</span>
          <IconChevronDown size={12} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => {
        const navigate = () => {
          close();
          onNavigate?.();
        };
        return (
          <div className="ws-menu">
            <SubmenuMenuButton
              icon={<IconAdjustments size={16} />}
              label="Preferences"
            >
              <ThemeMenuItems />
              <MenuDivider />
              <MenuLink
                label="All preferences"
                to="/settings/preferences"
                onNavigate={navigate}
              />
            </SubmenuMenuButton>
            <MenuDivider />
            {platformAdmin ? (
              <>
                <MenuButton
                  icon={<IconWorld size={16} />}
                  label="Platform Administration"
                  disabled={!workspaceMenu?.onOpenPlatformAdmin}
                  title={
                    workspaceMenu?.onOpenPlatformAdmin
                      ? undefined
                      : "Platform administration is not connected."
                  }
                  onSelect={() => {
                    close();
                    void workspaceMenu?.onOpenPlatformAdmin?.();
                  }}
                />
                <MenuDivider />
              </>
            ) : null}
            <div className="ws-workspace-picker">
              {entries.length > 3 ? (
                <div className="ws-workspace-search">
                  <input
                    type="search"
                    value={search}
                    placeholder="Search workspaces..."
                    aria-label="Search workspaces"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              ) : null}
              {filteredEntries.map((entry) => {
                const active = entry.id === workspace.id;
                const handler = active
                  ? navigate
                  : entry.needsLogin
                    ? workspaceMenu?.onLoginToWorkspace
                      ? () => {
                          close();
                          void workspaceMenu.onLoginToWorkspace?.(entry.id);
                        }
                      : undefined
                    : workspaceMenu?.onSwitchWorkspace
                      ? () => {
                          close();
                          void workspaceMenu.onSwitchWorkspace?.(entry.id);
                        }
                      : undefined;
                const subtitle = workspaceSubtitle(entry);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    data-menu-item="true"
                    disabled={!handler}
                    title={
                      handler
                        ? undefined
                        : entry.needsLogin
                          ? "Workspace login is not connected."
                          : "Workspace switching is not connected."
                    }
                    className={`ws-workspace-row${active ? " is-active" : ""}`}
                    onClick={handler}
                  >
                    <span className="ws-workspace-row-body">
                      <span className="ws-workspace-row-title">
                        {entry.name}
                      </span>
                      {subtitle.length > 0 ? (
                        <span className="ws-workspace-row-subtitle">
                          {subtitle.map((part, index) => (
                            <span key={`${entry.id}-${index}`}>
                              {index > 0 ? (
                                <span
                                  className="ws-workspace-row-divider"
                                  aria-hidden="true"
                                />
                              ) : null}
                              {part}
                            </span>
                          ))}
                          {entry.needsLogin && entry.ssoEnforced ? (
                            <span className="ws-tag">SSO required</span>
                          ) : null}
                        </span>
                      ) : entry.needsLogin && entry.ssoEnforced ? (
                        <span className="ws-workspace-row-subtitle">
                          <span className="ws-tag">SSO required</span>
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <IconCheck size={16} aria-hidden="true" />
                    ) : entry.needsLogin ? (
                      <IconLogin
                        className="ws-login-icon"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {workspaceMenu?.canAddWorkspace !== false ? (
              <MenuButton
                icon={<IconPlus size={16} />}
                label="Add a new workspace"
                disabled={
                  workspaceMenu?.canAddWorkspace !== true ||
                  !workspaceMenu.onAddWorkspace
                }
                title={
                  workspaceMenu?.canAddWorkspace === true &&
                  workspaceMenu.onAddWorkspace
                    ? undefined
                    : "Adding a workspace is not connected."
                }
                onSelect={() => {
                  close();
                  void workspaceMenu?.onAddWorkspace?.();
                }}
              />
            ) : null}
            <MenuDivider />
            <MenuButton
              icon={<IconArrowRight size={16} />}
              label={logoutLabel}
              disabled={!workspaceMenu?.onLogout}
              title={
                workspaceMenu?.onLogout
                  ? undefined
                  : "Log out is not connected."
              }
              onSelect={() => {
                close();
                void workspaceMenu?.onLogout?.();
              }}
            />
            {authedCount > 1 ? (
              <MenuButton
                icon={<IconLogout size={16} />}
                label="Log out of all workspaces"
                disabled={!workspaceMenu?.onLogoutAll}
                title={
                  workspaceMenu?.onLogoutAll
                    ? undefined
                    : "Log out of all workspaces is not connected."
                }
                onSelect={() => {
                  close();
                  void workspaceMenu?.onLogoutAll?.();
                }}
              />
            ) : null}
          </div>
        );
      }}
    </Popover>
  );
}
