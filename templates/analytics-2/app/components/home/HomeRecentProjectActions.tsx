import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconDots,
  IconNotebook,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ArchiveProjectDialog } from "@/components/projects/ArchiveProjectDialog";
import { appMountedHref } from "@/components/projects/projectList";
import { TrashProjectDialog } from "@/components/projects/TrashProjectDialog";
import { useCopyProjectLink } from "@/components/projects/useCopyProjectLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { HomeCallbacks, HomeRecentRow } from "./types";

export function HomeRecentProjectFavorite({
  row,
  callbacks,
}: {
  row: HomeRecentRow;
  callbacks: HomeCallbacks;
}) {
  const t = useT();
  const [pending, setPending] = useState<boolean | null>(null);
  const writing = useRef(false);
  const toggle = callbacks.onToggleFavoriteProject;
  if (row.kind !== "project" || row.favorited === undefined || !toggle)
    return null;
  const favorited = pending ?? row.favorited;
  const label = t(
    favorited
      ? "analytics.lists.actionRemoveFromFavorites"
      : "analytics.lists.actionAddFavorite",
  );
  const change = async () => {
    if (writing.current) return;
    writing.current = true;
    const next = !favorited;
    setPending(next);
    try {
      await toggle(row.id, next);
      toast.success(
        t(
          next
            ? "analytics.home.projectFavorited"
            : "analytics.home.projectUnfavorited",
        ),
      );
    } catch {
      toast.error(
        t(
          next
            ? "analytics.lists.favoriteFailed"
            : "analytics.lists.unfavoriteFailed",
          {
            noun: t("analytics.lists.projectNoun"),
          },
        ),
      );
    } finally {
      writing.current = false;
      setPending(null);
    }
  };
  return (
    <button
      type="button"
      className="ws-home-recent-star"
      aria-label={label}
      title={label}
      aria-pressed={favorited}
      disabled={pending !== null}
      onClick={() => void change()}
    >
      {favorited ? (
        <IconStarFilled size={14} aria-hidden="true" />
      ) : (
        <IconStar size={14} aria-hidden="true" />
      )}
    </button>
  );
}

export function HomeRecentProjectActions({
  row,
  callbacks,
}: {
  row: HomeRecentRow;
  callbacks: HomeCallbacks;
}) {
  const t = useT();
  const copyProjectLink = useCopyProjectLink();
  const navigate = useNavigate();
  const [operation, setOperation] = useState<"archive" | "trash" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (row.kind !== "project") return null;
  const hasMenu = !!(callbacks.onArchiveProject || callbacks.onTrashProject);
  const notebookLabel = t(
    row.canEdit ? "analytics.home.editDraft" : "analytics.home.viewNotebook",
  );
  const cancel = () => {
    if (!pending) {
      setOperation(null);
      setError(null);
    }
  };
  const confirm = async () => {
    const action =
      operation === "trash"
        ? callbacks.onTrashProject
        : callbacks.onArchiveProject;
    if (!action || pending) return;
    setPending(true);
    setError(null);
    try {
      await action(row.id);
      setOperation(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              operation === "trash"
                ? "analytics.lists.trashFailed"
                : "analytics.lists.archiveFailed",
              { noun: t("analytics.lists.projectNoun") },
            ),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      {row.notebookHref ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="ws-home-recent-notebook"
          aria-label={notebookLabel}
          title={notebookLabel}
          onClick={(event) => {
            const href = row.notebookHref;
            if (!href) return;
            if (event.metaKey || event.ctrlKey) {
              window.open(
                appMountedHref(href, appBasePath()),
                "_blank",
                "noopener",
              );
            } else {
              void navigate(href);
            }
          }}
        >
          <IconNotebook size={14} aria-hidden="true" />
        </Button>
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("analytics.lists.moreSelectionActions")}
            >
              <IconDots size={14} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a
                href={appMountedHref(row.href, appBasePath())}
                target="_blank"
                rel="noreferrer"
              >
                {t("analytics.lists.actionOpenNewTab")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyProjectLink(row.id)}>
              {t("analytics.lists.actionCopyLink")}
            </DropdownMenuItem>
            {callbacks.onArchiveProject ? (
              <DropdownMenuItem onSelect={() => setOperation("archive")}>
                {t("analytics.lists.actionArchive")}
              </DropdownMenuItem>
            ) : null}
            {callbacks.onTrashProject ? (
              <DropdownMenuItem onSelect={() => setOperation("trash")}>
                {t("analytics.lists.actionMoveToTrash")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {operation === "trash" ? (
        <TrashProjectDialog
          projectTitle={row.title}
          pending={pending}
          error={error}
          onCancel={cancel}
          onConfirm={() => void confirm()}
        />
      ) : null}
      {operation === "archive" ? (
        <ArchiveProjectDialog
          pending={pending}
          error={error}
          onCancel={cancel}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}
