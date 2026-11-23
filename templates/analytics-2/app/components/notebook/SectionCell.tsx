import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconGripVertical,
  IconPlayerPlay,
  IconTypography,
} from "@tabler/icons-react";
import { useId, useRef, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  useCellDragSource,
  useCellDropTarget,
  type CellDropPlacement,
} from "./cell-drag";
import type { SectionConfig } from "./types";

type SectionDestination = {
  id: string;
  title: string;
  depth: number;
  disabled: boolean;
};

export function SectionDestinationItems({
  getOptions,
  onGroup,
  onMove,
}: {
  getOptions: () => { destinations: SectionDestination[]; canGroup: boolean };
  onGroup: () => void;
  onMove: (id: string) => void;
}) {
  const t = useT();
  const { destinations, canGroup } = getOptions();
  return (
    <>
      {destinations.length === 0 ? (
        <DropdownMenuItem disabled>
          {t("notebook.section.noExisting")}
        </DropdownMenuItem>
      ) : (
        destinations.map(({ id, title, depth, disabled }) => (
          <DropdownMenuItem
            key={id}
            disabled={disabled}
            onSelect={() => onMove(id)}
          >
            <span style={{ marginInlineStart: `${depth}em` }}>{title}</span>
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!canGroup} onSelect={onGroup}>
        {t("notebook.section.new")}
      </DropdownMenuItem>
    </>
  );
}

const headings = ["h1", "h2", "h3"] as const;
const styles = ["auto", ...headings, "label"] as const;

export function SectionCell({
  id,
  title,
  collapsed,
  depth,
  headingStyle = "auto",
  selected,
  empty,
  status,
  error,
  canDrag,
  canChangeStructure,
  configPending,
  runBusy,
  destinationMenu,
  children,
  onToggle,
  onConfigure,
  onDropCell,
  onDelete,
  onEject,
  onRun,
}: {
  id: string;
  title: string | null;
  collapsed: boolean;
  depth: number;
  headingStyle?: SectionConfig["headingStyle"];
  selected: boolean;
  empty: boolean;
  status?:
    | { count: number; kind: "running" | "errored"; jump: () => void }
    | undefined;
  error?: string | undefined;
  canDrag: boolean;
  canChangeStructure: boolean;
  configPending: boolean;
  runBusy: boolean;
  destinationMenu?: ReactNode;
  children: ReactNode;
  onToggle: () => void;
  onConfigure?: ((config: SectionConfig) => void) | undefined;
  onDropCell?:
    | ((draggedCellId: string, placement: CellDropPlacement) => void)
    | undefined;
  onDelete: () => Promise<boolean>;
  onEject: () => void;
  onRun?: (() => void) | undefined;
}) {
  const t = useT();
  const bodyId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const skipMenuFocusRestore = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const drag = useCellDragSource(id);
  const drop = useCellDropTarget(onDropCell, "section");
  const emptyDrop = useCellDropTarget(onDropCell, "inside");
  const displayTitle = title || t("notebook.section.name");
  const autoHeading = headings[depth] ?? "h3";
  const heading = headingStyle === "auto" ? autoHeading : headingStyle;
  const styleLabel = (style: (typeof styles)[number]) =>
    style === "auto"
      ? t("notebook.section.auto", {
          heading: t(`notebook.section.${autoHeading}`),
        })
      : t(`notebook.section.${style}`);
  const rename = () => setDraft(title ?? "");
  const remove = async () => {
    setDeleting(true);
    try {
      if (await onDelete()) setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <article
        className={`nb-section-header${selected ? " is-selected" : ""}${drag.dragging ? " is-dragging" : ""}`}
        data-notebook-cell={id}
        data-section-drop={drop.placement ?? undefined}
        aria-keyshortcuts={
          canChangeStructure
            ? "Control+ArrowLeft Meta+ArrowLeft Control+ArrowRight Meta+ArrowRight"
            : undefined
        }
        tabIndex={-1}
        {...drop.dropProps}
      >
        <div className="nb-section-gutter">
          {canDrag && (
            <button
              type="button"
              className="nb-icon-button nb-drag-handle"
              aria-label={t("dashboards.panel.drag")}
              {...drag.gripProps}
            >
              <IconGripVertical size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="nb-icon-button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={t(
              collapsed ? "notebook.cellExpand" : "notebook.cellCollapse",
            )}
            disabled={configPending}
            onClick={onToggle}
          >
            {collapsed ? (
              <IconChevronRight size={16} aria-hidden="true" />
            ) : (
              <IconChevronDown size={16} aria-hidden="true" />
            )}
          </button>
        </div>
        {draft === null ? (
          <div
            className={`nb-section-title nb-section-${heading}`}
            role={heading === "label" ? undefined : "heading"}
            aria-level={
              heading === "label" ? undefined : headings.indexOf(heading) + 2
            }
            onDoubleClick={onConfigure && !configPending ? rename : undefined}
          >
            {displayTitle}
          </div>
        ) : (
          <input
            ref={renameInputRef}
            className={`nb-cell-title-input nb-section-title nb-section-${heading}`}
            type="text"
            aria-label={t("notebook.cellTitleLabel")}
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = draft.trim() || null;
              setDraft(null);
              if (next !== (title || null)) onConfigure?.({ title: next });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(null);
              }
            }}
          />
        )}
        {status && collapsed && (
          <button
            type="button"
            className="nb-section-status nb-text-button"
            data-section-status={status.kind}
            onClick={status.jump}
          >
            {t(
              status.kind === "errored"
                ? status.count === 1
                  ? "notebook.section.erroredOne"
                  : "notebook.section.erroredMany"
                : status.count === 1
                  ? "notebook.section.runningOne"
                  : "notebook.section.runningMany",
              { count: status.count },
            )}
          </button>
        )}
        {onConfigure && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nb-icon-button nb-section-style"
                aria-label={t("notebook.section.headingStyle")}
                disabled={configPending}
              >
                <IconTypography size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="nb-popover nb-menu-list"
              align="end"
            >
              <DropdownMenuRadioGroup value={headingStyle}>
                {styles.map((style) => (
                  <DropdownMenuRadioItem
                    key={style}
                    value={style}
                    onSelect={() => onConfigure({ headingStyle: style })}
                  >
                    {styleLabel(style)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onRun && (
          <button
            type="button"
            className="nb-icon-button"
            aria-label={t("notebook.section.run")}
            disabled={runBusy}
            onClick={onRun}
          >
            <IconPlayerPlay size={15} aria-hidden="true" />
          </button>
        )}
        {onConfigure && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nb-icon-button"
                aria-label={t("notebook.moreCellActions", {
                  title: displayTitle,
                })}
              >
                <IconDots size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="nb-popover nb-menu-list"
              align="end"
              onCloseAutoFocus={(event) => {
                if (skipMenuFocusRestore.current) {
                  event.preventDefault();
                  skipMenuFocusRestore.current = false;
                  renameInputRef.current?.focus();
                }
              }}
            >
              <DropdownMenuItem
                disabled={configPending}
                onSelect={() => {
                  skipMenuFocusRestore.current = true;
                  rename();
                }}
              >
                {t("notebook.cellMenu.rename")}
              </DropdownMenuItem>
              {destinationMenu}
              {!empty && (
                <DropdownMenuItem
                  disabled={!canChangeStructure}
                  onSelect={onEject}
                >
                  {t("notebook.section.eject")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="is-danger"
                disabled={!canChangeStructure}
                onSelect={() => {
                  if (empty) void remove();
                  else setConfirmDelete(true);
                }}
              >
                {t("notebook.cellMenu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </article>
      {error && (
        <p className="nb-banner nb-banner-danger" role="alert">
          {error}
        </p>
      )}
      <div id={bodyId} className="nb-section-body" hidden={collapsed}>
        {!collapsed && (
          <>
            {empty && onConfigure && (
              <div
                className="nb-section-empty"
                data-section-drop={emptyDrop.placement ?? undefined}
                {...emptyDrop.dropProps}
              >
                {t("notebook.section.empty")}
              </div>
            )}
            {children}
          </>
        )}
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!deleting) setConfirmDelete(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("notebook.section.confirmDelete")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("notebook.section.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || !canChangeStructure}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {t("notebook.section.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
