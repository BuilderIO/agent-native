import { appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowForwardUp,
  IconClockX,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconLink,
  IconPencil,
  IconPin,
  IconTrash,
} from "@tabler/icons-react";
import {
  createContext,
  Fragment,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Fade a row's title under its revealed actions instead of re-truncating it,
 * so the text never shifts under the pointer. Keyed by how many 24px action
 * buttons the row reveals.
 */
export function sidebarRowTitleFadeClassName(actionCount: 1 | 2) {
  return actionCount === 1
    ? "group-hover:[mask-image:linear-gradient(to_left,transparent_1.5rem,#000_2.5rem)] group-focus-within:[mask-image:linear-gradient(to_left,transparent_1.5rem,#000_2.5rem)]"
    : "group-hover:[mask-image:linear-gradient(to_left,transparent_3rem,#000_4rem)] group-focus-within:[mask-image:linear-gradient(to_left,transparent_3rem,#000_4rem)]";
}

export const sidebarRowActionButtonClassName =
  "flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Row actions pinned to the end of a `group relative` sidebar row. They appear
 * on hover or focus and stay put while one of their menus is open.
 */
export function SidebarRowActions({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute end-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 px-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">
      {children}
    </div>
  );
}

/** A row's "…" menu; each section decides which items it offers. */
export function SidebarRowMenu({
  label,
  onCloseAutoFocus,
  onOpenChange,
  children,
}: {
  label: string;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={sidebarRowActionButtonClassName}
          aria-label={t("sidebar.moreActionsFor", { label })}
        >
          <IconDots size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SidebarPinMenuItem({
  pinned,
  onSelect,
}: {
  pinned: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <IconPin className="me-2 size-4" strokeWidth={pinned ? 2.2 : 1.7} />
      {pinned ? t("sidebar.unpinFromSidebar") : t("sidebar.pinToSidebar")}
    </DropdownMenuItem>
  );
}

/**
 * Where a sidebar Page opens and what its copied link is. Local-file Pages
 * are not published, so their link is the in-app URL rather than /p/.
 */
export function sidebarPageLinks(
  documentId: string,
  { localFile = false }: { localFile?: boolean } = {},
) {
  const pagePath = appPath(`/page/${documentId}`);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return {
    href: pagePath,
    shareLink: `${origin}${localFile ? pagePath : appPath(`/p/${documentId}`)}`,
  };
}

/** Page mutations the sidebar row menu can start, owned by DocumentSidebar. */
export interface SidebarPageActions {
  renamePage: (documentId: string, title: string) => Promise<void>;
  duplicatePage: (documentId: string) => void;
  movePage: (page: {
    documentId: string;
    title: string;
    spaceId: string | null;
  }) => void;
}

const SidebarPageActionsContext = createContext<SidebarPageActions | null>(
  null,
);

export const SidebarPageActionsProvider = SidebarPageActionsContext.Provider;

export function useSidebarPageActions() {
  return useContext(SidebarPageActionsContext);
}

/**
 * The one sidebar Page menu. Every section renders it and passes only the
 * actions it allows, so Files, Pinned, and Recent share order, labels, and
 * behavior. Groups follow Notion's shape: pin; link and open; change the
 * Page; lifecycle; then who last edited it.
 */
export function SidebarPageMenu({
  documentId,
  title,
  href,
  shareLink,
  pinned,
  onTogglePin,
  onRename,
  onDuplicate,
  onMove,
  onRemoveFromRecent,
  onMoveToTrash,
}: {
  documentId: string;
  title: string;
  href: string;
  shareLink: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onMove?: () => void;
  onRemoveFromRecent?: () => void;
  onMoveToTrash?: () => void;
}) {
  const t = useT();
  // Rename swaps the row for an input. Start it only after the menu has
  // closed and skip Radix's focus return to the "…" trigger; otherwise the
  // menu's focus trap steals focus and the blur commits the input at once.
  const pendingRenameRef = useRef(false);
  const [open, setOpen] = useState(false);

  async function copyLink() {
    if (await writeClipboardText(shareLink)) {
      toast.success(t("editor.toolbar.copiedPageLink"));
    } else {
      toast.error(t("editor.toolbar.couldNotCopyLink"), {
        description: t("editor.toolbar.clipboardAccessUnavailable"),
      });
    }
  }

  const groups: ReactNode[][] = [
    onTogglePin && pinned !== undefined
      ? [
          <SidebarPinMenuItem
            key="pin"
            pinned={pinned}
            onSelect={onTogglePin}
          />,
        ]
      : [],
    [
      <DropdownMenuItem key="copy" onSelect={() => void copyLink()}>
        <IconLink className="me-2 size-4" />
        {t("sidebar.copyLink")}
      </DropdownMenuItem>,
      <DropdownMenuItem key="open" asChild>
        <a href={href} target="_blank" rel="noopener noreferrer">
          <IconExternalLink className="me-2 size-4" />
          {t("sidebar.openInNewTab")}
        </a>
      </DropdownMenuItem>,
    ],
    [
      onRename ? (
        <DropdownMenuItem
          key="rename"
          onSelect={() => {
            pendingRenameRef.current = true;
          }}
        >
          <IconPencil className="me-2 size-4" />
          {t("sidebar.rename")}
        </DropdownMenuItem>
      ) : null,
      onDuplicate ? (
        <DropdownMenuItem key="duplicate" onSelect={onDuplicate}>
          <IconCopy className="me-2 size-4" />
          {t("sidebar.duplicate")}
        </DropdownMenuItem>
      ) : null,
      onMove ? (
        <DropdownMenuItem key="move" onSelect={onMove}>
          <IconArrowForwardUp className="me-2 size-4" />
          {t("sidebar.moveTo")}
        </DropdownMenuItem>
      ) : null,
    ].filter(Boolean),
    [
      onRemoveFromRecent ? (
        <DropdownMenuItem key="forget" onSelect={onRemoveFromRecent}>
          <IconClockX className="me-2 size-4" />
          {t("sidebar.removeFromRecent")}
        </DropdownMenuItem>
      ) : null,
      onMoveToTrash ? (
        <DropdownMenuItem
          key="trash"
          className="text-destructive focus:text-destructive"
          onSelect={onMoveToTrash}
        >
          <IconTrash className="me-2 size-4" />
          {t("sidebar.moveToTrash")}
        </DropdownMenuItem>
      ) : null,
    ].filter(Boolean),
  ].filter((group) => group.length > 0);

  return (
    <SidebarRowMenu
      label={title}
      onOpenChange={setOpen}
      onCloseAutoFocus={(event) => {
        if (!pendingRenameRef.current) return;
        pendingRenameRef.current = false;
        event.preventDefault();
        onRename?.();
      }}
    >
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group}
        </Fragment>
      ))}
      <DropdownMenuSeparator />
      <SidebarPageActivity documentId={documentId} enabled={open} />
    </SidebarRowMenu>
  );
}

/**
 * "Last edited by … · when", read only while the menu is open. It renders a
 * fixed two-line block so the menu does not jump when the read resolves.
 */
function SidebarPageActivity({
  documentId,
  enabled,
}: {
  documentId: string;
  enabled: boolean;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  // Every row renders a menu; only the open one reads its activity.
  const activity = useActionQuery(
    "get-document-activity",
    { id: documentId },
    { enabled },
  );
  if (activity.isError) return null;
  const data = activity.data;
  const editor = data?.updatedByName ?? data?.updatedBy ?? null;
  return (
    <div
      className="grid gap-0.5 px-2 py-1.5 text-xs text-muted-foreground"
      data-sidebar-page-activity
    >
      {data ? (
        <>
          <span className="truncate">
            {editor
              ? t("sidebar.lastEditedBy", { name: editor })
              : t("sidebar.lastEdited")}
          </span>
          <span className="tabular-nums">
            {formatDate(data.updatedAt, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </>
      ) : (
        <>
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </>
      )}
    </div>
  );
}
