import { actionErrorCode } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconAlertCircle,
  IconAppWindow,
  IconArchive,
  IconChevronDown,
  IconCode,
  IconCopy,
  IconDots,
  IconEraser,
  IconExternalLink,
  IconFileDownload,
  IconFolderShare,
  IconHistory,
  IconMessage,
  IconMessageCircle,
  IconNotebook,
  IconLayoutSidebarRight,
  IconPencil,
  IconPlus,
  IconShare,
  IconStar,
  IconStarFilled,
  IconHierarchy2,
  IconStopwatch,
  IconTag,
  IconTrash,
  IconUser,
  IconWorldUpload,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { CharacterCount } from "@/components/ui/CharacterCount";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notebookMessages } from "@/i18n/messages/notebook";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  UNTITLED_PROJECT_NAME,
} from "@/lib/model/contracts";

import { ConfirmTrashDialog } from "./ConfirmTrashDialog";
import type { NotebookActionError, NotebookProjectView } from "./types";
import { toNotebookError } from "./utils";

const TITLE_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = PROJECT_DESCRIPTION_MAX_LENGTH;

const VIEW_TABS: ReadonlyArray<{
  view: NotebookProjectView;
  labelKey: string;
  icon: ReactNode;
}> = [
  {
    view: "agent",
    labelKey: "analytics.navigation.agent",
    icon: <IconMessageCircle size={14} aria-hidden="true" />,
  },
  {
    view: "notebook",
    labelKey: "analytics.navigation.notebook",
    icon: <IconNotebook size={14} aria-hidden="true" />,
  },
  {
    view: "app",
    labelKey: "analytics.navigation.appBuilder",
    icon: <IconAppWindow size={14} aria-hidden="true" />,
  },
];

const SECONDARY_VIEWS: ReadonlyArray<{
  view: NotebookProjectView;
  labelKey: string;
  icon: ReactNode;
}> = [
  {
    view: "source",
    labelKey: "notebookHeader.source",
    icon: <IconCode size={14} aria-hidden="true" />,
  },
  {
    view: "graph",
    labelKey: "notebookHeader.graphMode",
    icon: <IconHierarchy2 size={14} aria-hidden="true" />,
  },
  {
    view: "run-stats",
    labelKey: "notebookHeader.runStats",
    icon: <IconStopwatch size={14} aria-hidden="true" />,
  },
];

export function ProjectHeader({
  title,
  canRename,
  onRename,
  focusTitle = false,
  untitledOrdinal,
  onTitleEditingChange,
  provisional = false,
  isVersionPreview = false,
  view = "notebook",
  views,
  onSelectView,
  onShare,
  onPublish,
  publishedAppPath,
  publishDisabled = false,
  publishPending = false,
  hasPublishedApp = publishedAppPath != null,
  onOpenHistory,
  agentOpen = false,
  onToggleAgent,
  cellErrors,
  onOpenComments,
  onTrash,
  onExportIpynb,
  onExportYaml,
  onAddToCollection,
  onArchive,
  onNewProject,
  favorited = false,
  onFavorite,
  favoriteLabel,
  unfavoriteLabel,
  onDuplicate,
  onTransfer,
  onStatus,
  onCategories,
  description = "",
  onSaveDescription,
  onClearOutputs,
  notebookPickers,
  renderWorkbench,
}: {
  title: string;
  canRename: boolean;
  onRename: (title: string, applyToLatest?: boolean) => Promise<void>;
  focusTitle?: boolean | undefined;
  untitledOrdinal?: number | null | undefined;
  onTitleEditingChange?: (editing: boolean) => void;
  provisional?: boolean;
  isVersionPreview?: boolean;
  view?: NotebookProjectView;
  /** Views this build can actually show; a missing view is not offered. */
  views?: readonly NotebookProjectView[];
  onSelectView?:
    | ((view: NotebookProjectView) => Promise<void> | void)
    | undefined;
  onShare?: (() => Promise<void> | void) | undefined;
  publishedAppPath?: string | undefined;
  publishDisabled?: boolean;
  publishPending?: boolean;
  hasPublishedApp?: boolean;
  onOpenHistory?: (() => void) | undefined;
  agentOpen?: boolean;
  onToggleAgent?: (() => Promise<void> | void) | undefined;
  cellErrors?:
    | { count: number; labels?: string[]; jump: () => void }
    | undefined;
  onPublish?: (() => Promise<void> | void) | undefined;
  onOpenComments?: (() => Promise<void> | void) | undefined;
  onTrash?: (() => Promise<void>) | undefined;
  onExportIpynb?: (() => Promise<void> | void) | undefined;
  onExportYaml?: (() => Promise<void> | void) | undefined;
  onAddToCollection?: (() => void) | undefined;
  onArchive?: (() => Promise<void>) | undefined;
  onNewProject?: (() => Promise<void>) | undefined;
  favorited?: boolean | undefined;
  onFavorite?: ((favorited: boolean) => Promise<boolean>) | undefined;
  favoriteLabel?: string | undefined;
  unfavoriteLabel?: string | undefined;
  onDuplicate?: (() => Promise<void> | void) | undefined;
  onTransfer?: (() => void) | undefined;
  onStatus?: (() => void) | undefined;
  onCategories?: (() => void) | undefined;
  description?: string;
  onSaveDescription?:
    | ((description: string) => Promise<void> | void)
    | undefined;
  onClearOutputs?: (() => void) | undefined;
  notebookPickers?: ReactNode;
  renderWorkbench?: ((metadata: ReactNode) => ReactNode) | undefined;
}) {
  const t = useT();
  const showNotebookMetadata =
    renderWorkbench != null && (view === "notebook" || view === "agent");
  const descriptionPlaceholder = t("notebookHeader.addDescription", {
    defaultValue: notebookMessages.notebookHeader.addDescription,
  });
  const publishLabel = t(
    hasPublishedApp ? "publishedApp.publishChanges" : "publishedApp.publish",
  );
  const projectOptionsLabel = t("notebookHeader.projectOptions");
  const viewAppLabel = t("analytics.shell.search.viewApp", {
    defaultValue: "View app",
  });
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    (NotebookActionError & { source: "description" | "menu" }) | null
  >(null);
  const [renameError, setRenameError] = useState<{
    conflict: boolean;
    detail: string;
  } | null>(null);
  const [renamed, setRenamed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteValue, setFavoriteValue] = useState(favorited);
  const [favoritePending, setFavoritePending] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [descriptionPending, setDescriptionPending] = useState(false);
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(
    null,
  );
  const [trashOpen, setTrashOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const titleFocused = useRef(false);
  const editingTitle = useRef(false);
  const restoreFocusOnCancelRef = useRef(false);
  const renameFromMenu = useRef(false);
  const renameFromObservedTitle = useRef(onRename);

  const secondaryViews = SECONDARY_VIEWS.filter(
    (tab) => onSelectView != null && views != null && views.includes(tab.view),
  );
  const displayTitle = titleOverride ?? title;
  const placeholder = titleOverride === null && untitledOrdinal != null;
  const shownTitle = placeholder
    ? untitledOrdinal === 1
      ? t("notebookCreation.untitled", { defaultValue: UNTITLED_PROJECT_NAME })
      : t("notebookCreation.untitledNumbered", {
          number: untitledOrdinal,
          defaultValue: `${UNTITLED_PROJECT_NAME} (${untitledOrdinal})`,
        })
    : displayTitle.trim() || UNTITLED_PROJECT_NAME;

  useEffect(() => {
    setTitleOverride(null);
  }, [title]);

  useEffect(() => {
    setDescriptionOverride(null);
  }, [description]);

  useEffect(() => {
    setFavoriteValue(favorited);
  }, [favorited]);

  useEffect(() => {
    if (focusTitle && !titleFocused.current && titleRef.current) {
      titleRef.current.focus({ preventScroll: true });
      titleFocused.current = true;
    }
  }, [focusTitle]);

  useEffect(() => {
    if (!editing) {
      if (restoreFocusOnCancelRef.current) {
        restoreFocusOnCancelRef.current = false;
        titleRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const input = inputRef.current;
    if (input == null) return;
    input.focus({ preventScroll: !showNotebookMetadata });
    input.select();
  }, [editing, showNotebookMetadata]);

  const startRename = () => {
    if (!canRename || pending) return;
    setMenuOpen(false);
    restoreFocusOnCancelRef.current = false;
    setDraft(
      placeholder || shownTitle === UNTITLED_PROJECT_NAME ? "" : shownTitle,
    );
    setError(null);
    setRenameError(null);
    setRenamed(false);
    renameFromObservedTitle.current = onRename;
    editingTitle.current = true;
    onTitleEditingChange?.(true);
    setEditing(true);
  };

  const cancelRename = (restoreFocus = false) => {
    editingTitle.current = false;
    restoreFocusOnCancelRef.current = restoreFocus;
    onTitleEditingChange?.(false);
    setEditing(false);
    setDraft(shownTitle);
    setError(null);
  };

  const commitRename = async (retry = false, applyToLatest = false) => {
    if (!canRename || (!editingTitle.current && !retry) || pending) return;
    const next = draft.trim().slice(0, TITLE_MAX_LENGTH);
    if (!next || (!placeholder && next === shownTitle)) {
      cancelRename();
      return;
    }
    editingTitle.current = false;
    setPending(true);
    setError(null);
    setRenameError(null);
    try {
      const write = applyToLatest
        ? onRename(next, true)
        : renameFromObservedTitle.current(next);
      onTitleEditingChange?.(false);
      await write;
      setTitleOverride(next);
      setDraft(next);
      setEditing(false);
      setRenamed(!provisional);
    } catch (error) {
      setRenameError({
        conflict: actionErrorCode(error) === "notebook_metadata_conflict",
        detail: toNotebookError(error).message,
      });
      setEditing(false);
    } finally {
      setPending(false);
    }
  };

  const commitDescription = async (value: string) => {
    if (descriptionPending || onSaveDescription == null) return;
    const next = value.trim().slice(0, DESCRIPTION_MAX_LENGTH);
    if (next === (descriptionOverride ?? description)) {
      setDescriptionDraft(null);
      return;
    }
    setDescriptionPending(true);
    setError(null);
    try {
      await onSaveDescription(next);
      setDescriptionOverride(next);
      setDescriptionDraft(null);
    } catch (saveError) {
      setError({ ...toNotebookError(saveError), source: "description" });
    } finally {
      setDescriptionPending(false);
    }
  };

  const toggleFavorite = async () => {
    if (onFavorite == null || favoritePending) return;
    const previous = favoriteValue;
    setFavoriteValue(!previous);
    setFavoritePending(true);
    setError(null);
    try {
      setFavoriteValue(await onFavorite(!previous));
    } catch (cause) {
      setFavoriteValue(previous);
      setError({ ...toNotebookError(cause), source: "menu" });
    } finally {
      setFavoritePending(false);
    }
  };

  const runMenuAction = async (action: () => Promise<void> | void) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError({ ...toNotebookError(cause), source: "menu" });
    }
  };

  const titleEditor =
    editing && canRename ? (
      <input
        ref={inputRef}
        className={
          showNotebookMetadata
            ? "nb-empty-title-input"
            : "nb-project-title-input"
        }
        aria-label={t("notebookCreation.projectTitle", {
          defaultValue: "Project title",
        })}
        maxLength={TITLE_MAX_LENGTH}
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          void commitRename();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelRename(true);
          }
        }}
      />
    ) : canRename ? (
      <button
        ref={titleRef}
        type="button"
        className={
          showNotebookMetadata
            ? undefined
            : `nb-project-title${placeholder ? " is-placeholder" : ""}`
        }
        title={shownTitle}
        onClick={startRename}
      >
        {shownTitle}
      </button>
    ) : (
      <span
        className={
          showNotebookMetadata ? undefined : "nb-project-title is-static"
        }
        title={shownTitle}
      >
        {shownTitle}
      </span>
    );
  const descriptionEditor =
    (descriptionOverride ?? description) !== "" || onSaveDescription != null ? (
      <div className="nb-project-description-row">
        {descriptionDraft != null && onSaveDescription != null ? (
          <>
            <textarea
              className="nb-project-description-input"
              aria-label={t("notebookHeader.descriptionLabel")}
              maxLength={DESCRIPTION_MAX_LENGTH}
              autoFocus
              rows={2}
              value={descriptionDraft}
              disabled={descriptionPending}
              placeholder={descriptionPlaceholder}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => {
                void commitDescription(descriptionDraft);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDescriptionDraft(null);
                  setError(null);
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <CharacterCount
              count={descriptionDraft.length}
              max={DESCRIPTION_MAX_LENGTH}
            />
          </>
        ) : (
          <button
            type="button"
            className="nb-project-description"
            disabled={onSaveDescription == null || descriptionPending}
            onClick={() =>
              setDescriptionDraft(descriptionOverride ?? description)
            }
          >
            {(descriptionOverride ?? description) === ""
              ? descriptionPlaceholder
              : (descriptionOverride ?? description)}
          </button>
        )}
      </div>
    ) : null;

  return (
    <>
      <header className="nb-header">
        <div className="nb-header-left">
          <Link
            to="/home"
            className="nb-brand-mark"
            aria-label={t("analytics.shell.home")}
            title={t("analytics.shell.home")}
          >
            <AgentNativeIcon size={18} />
          </Link>
          {showNotebookMetadata ? (
            canRename ? (
              <button
                type="button"
                className="nb-project-title"
                title={shownTitle}
                disabled={pending}
                onClick={startRename}
              >
                {shownTitle}
              </button>
            ) : (
              <span className="nb-project-title is-static" title={shownTitle}>
                {shownTitle}
              </span>
            )
          ) : (
            <>
              {titleEditor}
              {editing && canRename && (
                <CharacterCount count={draft.length} max={TITLE_MAX_LENGTH} />
              )}
            </>
          )}
          {!provisional && (
            <span className="sr-only" aria-live="polite">
              {pending
                ? t("notebookCreation.savingTitle")
                : renamed
                  ? t("notebookCreation.renamed")
                  : null}
            </span>
          )}
          {pending && <span className="nb-spinner" aria-hidden="true" />}
          {(canRename || isVersionPreview) && !provisional && (
            <DropdownMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              modal={false}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="nb-icon-button nb-title-menu-trigger"
                  aria-label={projectOptionsLabel}
                  aria-haspopup="menu"
                  disabled={pending}
                >
                  <IconChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                aria-label={projectOptionsLabel}
                align="start"
                className="nb-popover"
                onCloseAutoFocus={(event) => {
                  if (renameFromMenu.current) {
                    event.preventDefault();
                    renameFromMenu.current = false;
                    startRename();
                  }
                }}
                sideOffset={4}
                style={{ padding: 0, width: "auto", minWidth: 180 }}
              >
                <div className="nb-menu-list">
                  <DropdownMenuItem
                    className="nb-menu-item"
                    disabled={isVersionPreview}
                    title={
                      isVersionPreview
                        ? t("projectMenu.renameVersionDenied")
                        : undefined
                    }
                    onSelect={() => {
                      renameFromMenu.current = true;
                    }}
                  >
                    <IconPencil size={14} aria-hidden="true" />
                    {t("analytics.lists.actionRename")}
                  </DropdownMenuItem>
                  {onFavorite != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      disabled={favoritePending}
                      onSelect={() => void toggleFavorite()}
                    >
                      {favoriteValue ? (
                        <IconStarFilled size={14} aria-hidden="true" />
                      ) : (
                        <IconStar size={14} aria-hidden="true" />
                      )}
                      {favoriteValue
                        ? (unfavoriteLabel ?? t("notebook.unfavoriteProject"))
                        : (favoriteLabel ?? t("notebook.favoriteProject"))}
                    </DropdownMenuItem>
                  ) : null}
                  {onDuplicate != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => void onDuplicate()}
                    >
                      <IconCopy size={14} aria-hidden="true" />
                      {t("analytics.lists.actionDuplicate")}
                    </DropdownMenuItem>
                  ) : null}
                  {onExportYaml != null || onExportIpynb != null ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className="nb-menu-item"
                        disabled={isVersionPreview}
                        title={
                          isVersionPreview
                            ? t("projectMenu.exportVersionDenied")
                            : undefined
                        }
                      >
                        <IconFileDownload size={14} aria-hidden="true" />
                        {t("projectMenu.exportAs")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        aria-label={t("projectMenu.exportAs")}
                        className="nb-popover nb-menu-list"
                      >
                        {onExportYaml != null ? (
                          <DropdownMenuItem
                            className="nb-menu-item"
                            onSelect={() => void runMenuAction(onExportYaml)}
                          >
                            {t("projectMenu.exportYaml")}
                          </DropdownMenuItem>
                        ) : null}
                        {onExportIpynb != null ? (
                          <DropdownMenuItem
                            className="nb-menu-item"
                            onSelect={() => void runMenuAction(onExportIpynb)}
                          >
                            {t("projectMenu.exportIpynb")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  {onStatus != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => onStatus()}
                    >
                      <IconTag size={14} aria-hidden="true" />
                      {t("analytics.lists.actionSetStatus")}
                    </DropdownMenuItem>
                  ) : null}
                  {onClearOutputs != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      title={t("notebookHeader.clearOutputsHint")}
                      onSelect={() => onClearOutputs()}
                    >
                      <IconEraser size={14} aria-hidden="true" />
                      {t("notebook.runClearOutputs", {
                        defaultValue: notebookMessages.notebook.runClearOutputs,
                      })}
                    </DropdownMenuItem>
                  ) : null}
                  {onCategories != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => onCategories()}
                    >
                      <IconPlus size={14} aria-hidden="true" />
                      {t("notebook.metaPickers.addCategories")}
                    </DropdownMenuItem>
                  ) : null}
                  {onTransfer != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => onTransfer()}
                    >
                      <IconUser size={14} aria-hidden="true" />
                      {t("notebookHeader.transfer")}
                    </DropdownMenuItem>
                  ) : null}
                  {onAddToCollection != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => onAddToCollection()}
                    >
                      <IconPlus size={14} aria-hidden="true" />
                      {t("projectMenu.addToCollection")}
                    </DropdownMenuItem>
                  ) : null}
                  {onAddToCollection != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => onAddToCollection()}
                    >
                      <IconFolderShare size={14} aria-hidden="true" />
                      {t("projectMenu.moveTo")}
                    </DropdownMenuItem>
                  ) : null}
                  {onArchive != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => void runMenuAction(onArchive)}
                    >
                      <IconArchive size={14} aria-hidden="true" />
                      {t("projectMenu.archive")}
                    </DropdownMenuItem>
                  ) : null}
                  {onTrash != null ? (
                    <DropdownMenuItem
                      className="nb-menu-item"
                      onSelect={() => setTrashOpen(true)}
                    >
                      <IconTrash size={14} aria-hidden="true" />
                      {t("analytics.lists.actionMoveToTrash")}
                    </DropdownMenuItem>
                  ) : null}
                  {onNewProject != null ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="nb-menu-item"
                        aria-keyshortcuts="Alt+Shift+N"
                        onSelect={() => void runMenuAction(onNewProject)}
                      >
                        <IconPlus size={14} aria-hidden="true" />
                        {t("projectMenu.newProject")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <nav
          className="nb-view-tabs nb-header-center"
          aria-label={t("notebook.projectViews")}
        >
          {VIEW_TABS.filter(
            (tab) =>
              onSelectView != null &&
              (views == null || views.includes(tab.view)),
          ).map((tab) => (
            <button
              key={tab.view}
              type="button"
              className={`nb-view-tab${view === tab.view ? " is-active" : ""}`}
              aria-current={view === tab.view ? "page" : undefined}
              onClick={() => onSelectView?.(tab.view)}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
          {secondaryViews.length > 0 ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`nb-icon-button${secondaryViews.some((tab) => tab.view === view) ? " is-active" : ""}`}
                  aria-label={t("notebookHeader.moreViews")}
                  aria-haspopup="menu"
                >
                  <IconDots size={16} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                aria-label={t("notebookHeader.moreViews")}
                align="start"
                className="nb-popover"
                sideOffset={4}
                style={{ padding: 0, width: "auto", minWidth: 160 }}
              >
                <div className="nb-menu-list">
                  {secondaryViews.map((tab) => (
                    <DropdownMenuItem
                      key={tab.view}
                      className="nb-menu-item"
                      aria-current={view === tab.view ? "page" : undefined}
                      onSelect={() => void onSelectView?.(tab.view)}
                    >
                      {tab.icon}
                      {t(tab.labelKey)}
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </nav>
        <div className="nb-header-right">
          {cellErrors != null && (
            <Tooltip
              placement="bottom"
              content={
                <>
                  <strong className="block">
                    {t("notebookHeader.cellErrorsHeading")}
                  </strong>
                  {(cellErrors.labels ?? []).map((label, index) => (
                    <span className="block" key={index}>
                      {label}
                    </span>
                  ))}
                </>
              }
              trigger={
                <button
                  type="button"
                  className="nb-header-button nb-header-error"
                  aria-label={t("notebookHeader.cellErrors", {
                    count: cellErrors.count,
                  })}
                  onClick={cellErrors.jump}
                >
                  <IconAlertCircle size={14} aria-hidden="true" />
                  <span className="nb-header-label">{cellErrors.count}</span>
                </button>
              }
            />
          )}
          {publishedAppPath != null ? (
            <Link
              className="nb-header-button"
              title={t("publishedApp.goToLiveApp")}
              aria-label={t("publishedApp.goToLiveApp")}
              to={publishedAppPath}
            >
              <IconExternalLink size={14} aria-hidden="true" />
              <span className="nb-header-label">{viewAppLabel}</span>
            </Link>
          ) : null}
          {onOpenComments != null ? (
            <button
              type="button"
              className="nb-icon-button"
              aria-label={t("notebookHeader.comments")}
              onClick={() => void onOpenComments()}
            >
              <IconMessage size={16} aria-hidden="true" />
            </button>
          ) : null}
          {onShare != null ? (
            <button
              type="button"
              className="nb-header-button"
              aria-label={t("publishedAppSharing.share")}
              onClick={() => void onShare()}
            >
              <IconShare size={14} aria-hidden="true" />
              <span className="nb-header-label">
                {t("publishedAppSharing.share")}
              </span>
            </button>
          ) : null}
          {onPublish != null ? (
            <div className="nb-publish-split">
              <button
                type="button"
                className="nb-header-button nb-header-publish"
                disabled={publishDisabled || publishPending}
                aria-busy={publishPending}
                aria-label={publishLabel}
                onClick={() => void onPublish()}
              >
                {publishPending ? (
                  <span className="nb-spinner" aria-hidden="true" />
                ) : (
                  <IconWorldUpload size={14} aria-hidden="true" />
                )}
                <span className="nb-header-label">{publishLabel}</span>
              </button>
              {(publishedAppPath != null || onOpenHistory != null) && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="nb-header-button nb-publish-menu-trigger"
                      aria-label={t("publishedApp.publishActions")}
                    >
                      <IconChevronDown size={14} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="nb-popover nb-menu-list"
                    align="end"
                    sideOffset={4}
                    aria-label={t("publishedApp.publishActions")}
                  >
                    {publishedAppPath != null && (
                      <DropdownMenuItem className="nb-menu-item" asChild>
                        <Link
                          to={publishedAppPath}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <IconExternalLink size={14} aria-hidden="true" />
                          {t("notebookHeader.viewPublishedApp")}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {onOpenHistory != null && (
                      <DropdownMenuItem
                        className="nb-menu-item"
                        onSelect={onOpenHistory}
                      >
                        <IconHistory size={14} aria-hidden="true" />
                        {t("notebookHeader.versionHistory")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ) : null}
          {onToggleAgent != null && (
            <button
              type="button"
              className="nb-icon-button"
              aria-label={t("agentPanel.toggleAgent")}
              aria-pressed={agentOpen}
              onClick={() => void onToggleAgent()}
            >
              <IconLayoutSidebarRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {!showNotebookMetadata && descriptionEditor}
      {renameError && (
        <div className="nb-banner nb-banner-danger" role="alert">
          <p className="nb-banner-message">
            {t(
              renameError.conflict
                ? "notebookCreation.titleChanged"
                : "notebookCreation.titleFailed",
            )}
          </p>
          {!renameError.conflict && renameError.detail && (
            <details className="nb-banner-details">
              <summary>{t("notebookCreation.errorDetails")}</summary>
              <p>{renameError.detail}</p>
            </details>
          )}
          <div className="nb-banner-actions">
            <button
              type="button"
              className="nb-text-button"
              onClick={() => void commitRename(true, renameError.conflict)}
            >
              {t(
                renameError.conflict
                  ? "notebookCreation.applyTitle"
                  : "notebookCreation.retry",
              )}
            </button>
            {renameError.conflict && (
              <button
                type="button"
                className="nb-text-button"
                onClick={() => setRenameError(null)}
              >
                {t("notebookCreation.useLatest")}
              </button>
            )}
          </div>
        </div>
      )}
      {error != null && (
        <div className="nb-banner nb-banner-danger" role="alert">
          <p className="nb-banner-message">{error.message}</p>
          {error.details != null && (
            <details className="nb-banner-details">
              <summary>{t("notebookCreation.errorDetails")}</summary>
              <pre>{error.details}</pre>
            </details>
          )}
          <div className="nb-banner-actions">
            {error.source === "description" && descriptionDraft != null && (
              <button
                type="button"
                className="nb-text-button"
                disabled={descriptionPending}
                onClick={() => void commitDescription(descriptionDraft)}
              >
                {t("notebookCreation.retry")}
              </button>
            )}
            <button
              type="button"
              className="nb-text-button"
              disabled={pending}
              onClick={() => setError(null)}
            >
              {t("notebookHeader.dismiss")}
            </button>
          </div>
        </div>
      )}
      {renderWorkbench?.(
        showNotebookMetadata ? (
          <div className="nb-project-metadata">
            {notebookPickers}
            <h1 className="nb-empty-title">{titleEditor}</h1>
            {editing && canRename && (
              <CharacterCount count={draft.length} max={TITLE_MAX_LENGTH} />
            )}
            {descriptionEditor}
          </div>
        ) : null,
      )}
      {onTrash != null ? (
        <ConfirmTrashDialog
          isOpen={trashOpen}
          projectTitle={shownTitle}
          onClose={() => setTrashOpen(false)}
          onConfirm={onTrash}
        />
      ) : null}
    </>
  );
}
