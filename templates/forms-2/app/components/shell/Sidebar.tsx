import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import type { Folder } from "@shared/form-contract";
import {
  IconChevronDown,
  IconChevronRight,
  IconHome,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { NavLink } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formDisplayName } from "./format";
import { formHref, paths } from "./paths";

const rowClass =
  "mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-2 rounded-[7px] px-[10px] text-sm font-medium text-foreground hover:bg-accent";

function NavItem({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className="block text-base leading-[18.4px] font-normal"
    >
      {({ isActive }) => (
        <div className={cn(rowClass, isActive && "bg-accent")}>
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span>{children}</span>
        </div>
      )}
    </NavLink>
  );
}

function GroupLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-end px-[14px] pb-2 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function WorkspaceForms({
  workspaceId,
  folderId,
  indent = "px-[54px]",
}: {
  workspaceId: string;
  folderId: string;
  indent?: string;
}) {
  const t = useT();
  const forms = useActionQuery("list-forms", {
    workspaceId,
    folderId,
    limit: 100,
  });
  if (forms.isPending)
    return (
      <div
        role="status"
        aria-label={t("forms.common.loading")}
        className={cn("py-1", indent)}
      >
        <Skeleton className="h-4 w-24" />
      </div>
    );
  if (forms.isError)
    return (
      <button
        type="button"
        onClick={() => void forms.refetch()}
        className={cn(
          "h-7 text-left text-[13px] text-muted-foreground hover:underline",
          indent,
        )}
      >
        {t("forms.common.retry")}
      </button>
    );
  if (forms.data.forms.length === 0)
    return (
      <div
        className={cn(
          "h-7 text-[13px] leading-7 text-muted-foreground",
          indent,
        )}
      >
        {t("forms.common.noFormsYet")}
      </div>
    );
  return (
    <>
      {forms.data.forms.map((form) => (
        <NavLink
          key={form.id}
          to={formHref(form)}
          className={cn(
            "flex h-7 items-center truncate text-[13px] font-medium text-foreground hover:bg-accent",
            indent,
          )}
        >
          <span className="truncate">{formDisplayName(form, t)}</span>
        </NavLink>
      ))}
    </>
  );
}

function FolderItem({
  workspaceId,
  folder,
}: {
  workspaceId: string;
  folder: Folder;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? IconChevronDown : IconChevronRight;
  return (
    <div>
      <div className="flex h-7 items-center hover:bg-accent">
        <button
          type="button"
          aria-label={t(
            expanded ? "forms.shell.collapseItem" : "forms.shell.expandItem",
            { name: folder.name },
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="ml-[33px] flex h-5 w-[21px] items-center justify-center rounded-[5px] text-muted-foreground hover:bg-accent"
        >
          <Chevron className="size-4" />
        </button>
        <NavLink
          to={paths.folder(workspaceId, folder.id)}
          className="ml-[6px] min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
        >
          {folder.name}
        </NavLink>
      </div>
      {expanded ? (
        <WorkspaceForms
          workspaceId={workspaceId}
          folderId={folder.id}
          indent="px-[78px]"
        />
      ) : null}
    </div>
  );
}

function WorkspaceItem({
  id,
  name,
  folders,
}: {
  id: string;
  name: string;
  folders: Folder[];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? IconChevronDown : IconChevronRight;
  return (
    <div>
      <div className="flex h-7 items-center hover:bg-accent">
        <button
          type="button"
          aria-label={t(
            expanded ? "forms.shell.collapseItem" : "forms.shell.expandItem",
            { name },
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="ml-[9px] flex h-5 w-[21px] items-center justify-center rounded-[5px] text-muted-foreground hover:bg-accent"
        >
          <Chevron className="size-4" />
        </button>
        <NavLink
          to={paths.workspace(id)}
          className="ml-[8px] min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        >
          {name}
        </NavLink>
      </div>
      {expanded ? (
        <>
          {folders.map((folder) => (
            <FolderItem key={folder.id} workspaceId={id} folder={folder} />
          ))}
          <WorkspaceForms workspaceId={id} folderId="root" />
        </>
      ) : null}
    </div>
  );
}

export function Sidebar({ onOpenTrash }: { onOpenTrash: () => void }) {
  const t = useT();
  const workspaces = useActionQuery("list-workspaces", { formLimit: 0 });
  return (
    <div className="flex h-full w-[var(--forms-sidebar-width)] shrink-0 flex-col border-r border-r-border bg-sidebar-background">
      <div className="h-[46px] shrink-0 px-[6px] pt-[8px]">
        <OrgSwitcher
          reserveSpace
          currentAppId="forms-2"
          className="h-7 min-w-0 w-full justify-start rounded-md bg-transparent px-[6px] text-sm font-bold text-foreground hover:bg-accent"
        />
      </div>
      <nav
        aria-label={t("forms.shell.mainNav")}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <NavItem to={paths.home} icon={IconHome}>
          {t("forms.shell.home")}
        </NavItem>
        <button
          type="button"
          onClick={() => openCommandMenu()}
          className={rowClass}
        >
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <span>{t("forms.common.search")}</span>
        </button>
        <NavItem to="/settings/members" icon={IconUsers}>
          {t("forms.common.members")}
        </NavItem>
        <NavItem to="/settings" icon={IconSettings}>
          {t("forms.common.settings")}
        </NavItem>

        <GroupLabel className="mt-6">{t("forms.shell.workspaces")}</GroupLabel>
        {workspaces.isPending ? (
          <div
            role="status"
            aria-label={t("forms.common.loading")}
            className="flex flex-col gap-2 px-[14px] py-1.5"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ) : workspaces.isError ? (
          <button
            type="button"
            onClick={() => void workspaces.refetch()}
            className="h-7 px-[14px] text-left text-[13px] text-muted-foreground hover:underline"
          >
            {t("forms.shell.workspacesLoadFailed")}
          </button>
        ) : (
          workspaces.data.workspaces.map((workspace) => (
            <WorkspaceItem
              key={workspace.id}
              id={workspace.id}
              name={workspace.name}
              folders={workspace.folders}
            />
          ))
        )}

        <GroupLabel className="mt-4">{t("forms.shell.product")}</GroupLabel>
        <button type="button" onClick={onOpenTrash} className={rowClass}>
          <IconTrash className="size-4 shrink-0 text-muted-foreground" />
          <span>{t("forms.shell.trash")}</span>
        </button>
      </nav>
      <div className="flex h-12 shrink-0 items-center px-[10px]">
        <AgentToggleButton />
      </div>
    </div>
  );
}
