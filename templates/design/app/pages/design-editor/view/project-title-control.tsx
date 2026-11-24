import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import { linkSummaryResultSchema } from "@agent-native/core/shared";
import { designBriefsFromData, type DesignBrief } from "@shared/design-briefs";
import {
  IconChevronDown,
  IconExternalLink,
  IconFileText,
} from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";
import { shouldShowFullDesignProjectMenu } from "../mcp-widget-write-capabilities";
import { clearPendingEditSessionMarker } from "../pending-edit-session-marker";
import type { DesignData } from "../types";
import { ExportSubmenuContent } from "./export-submenu-content";

/**
 * The title and link of a Content page the design started from, as Content
 * returns them to the viewer. The design keeps only the page's id and link, so
 * the page is read under the viewer's own Content access; for anyone who can't
 * open it, while it loads, or when the read fails (even with an earlier read
 * still cached), there is no page. The stored link is never used, so it can't
 * point a "Built from" item somewhere Content didn't.
 */
function useBriefPages(
  briefs: readonly DesignBrief[],
  refetchOnMount: boolean | "always" = true,
) {
  const titles = useActionQuery(
    "read-brief-titles",
    { ids: briefs.map((brief) => brief.id) },
    {
      method: "GET",
      enabled: briefs.length > 0,
      staleTime: 5 * 60_000,
      retry: false,
      refetchOnMount,
    },
  );
  const read = titles.isError
    ? null
    : linkSummaryResultSchema.safeParse(titles.data);
  return briefs.map((brief, index) => {
    const summary = read?.success ? read.data.summaries[index] : undefined;
    return {
      brief,
      page: summary?.status === "available" ? summary : null,
    };
  });
}

function BriefTitlesPrefetch({ briefs }: { briefs: readonly DesignBrief[] }) {
  useBriefPages(briefs);
  return null;
}

export function BuiltFromItems({ briefs }: { briefs: readonly DesignBrief[] }) {
  // Opening the menu reads the page again, so access removed since the editor
  // opened takes the title away instead of showing it from the cache.
  return useBriefPages(briefs, "always").map(({ brief, page }) => (
    <BuiltFromItem key={`${brief.source}:${brief.id}`} page={page} />
  ));
}

function BuiltFromItem({
  page,
}: {
  page: { title: string; url: string } | null;
}) {
  const t = useT();
  if (!page) {
    return (
      <DropdownMenuItem disabled className="items-start">
        <IconFileText className="mt-0.5 size-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 break-words">
          {t("designEditor.fileMenu.builtFromPage")}
        </span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className="items-start">
      <a href={page.url} target="_blank" rel="noopener noreferrer">
        <IconExternalLink className="mt-0.5 size-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 break-words">
          {t("designEditor.fileMenu.builtFrom", { title: page.title })}
        </span>
      </a>
    </DropdownMenuItem>
  );
}

interface ProjectTitleControlProps {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorSourceAndSync: EditorSourceAndSync;
  design: DesignData;
  widgetEmbed: boolean;
}

function ProjectTitleControl({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorLiveEditsAndPresence,
  editorLayoutAndStructure,
  editorExportAndHandoff,
  editorSourceAndSync,
  design,
  widgetEmbed,
}: ProjectTitleControlProps) {
  const { t, id, queryClient } = editorCore;
  const { canEditDesign, canShareDesign, duplicateDesignMutation } =
    editorGenerationAndAccess;
  const {
    titleEditing,
    titleDraft,
    setTitleDraft,
    commitTitleEdit,
    handleTitleInputKeyDown,
    setTitleEditing,
    files,
  } = editorFilesAndSaving;
  const { hasPendingVisualStyleEdits, clearPendingLiveEditState } =
    editorHistory;
  const { setSaveTemplateOpen } = editorLiveEditsAndPresence;
  const { setHistoryOpen } = editorLayoutAndStructure;
  const { skipPendingEditNavigationBlockRef, openImportFilePicker } =
    editorSourceAndSync;
  const navigate = useNavigate();
  const deleteDesignMutation = useActionMutation("delete-design");
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const suppressFileMenuReturnFocusRef = useRef(false);

  const handleDuplicateDesign = useCallback(() => {
    if (!id) return;
    if (hasPendingVisualStyleEdits) {
      toast.error(t("designEditor.fileMenu.pendingEditsBlocked"));
      return;
    }
    duplicateDesignMutation
      .mutateAsync({ id } as any)
      .then((result: any) => {
        if (!result?.id) throw new Error("Missing copied design id");
        void navigate(`/design/${result.id}`);
      })
      .catch((error) =>
        reportWriteFailure(error, {
          label: t("designEditor.toasts.saveCopyError"),
        }),
      );
  }, [duplicateDesignMutation, hasPendingVisualStyleEdits, id, navigate, t]);

  const handleMoveToTrash = useCallback(() => {
    if (!id) return;
    setTrashDialogOpen(false);
    deleteDesignMutation
      .mutateAsync({ id } as any)
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
        // The design is gone, so its pending edits are moot; skip the
        // Stay/Discard prompt that would otherwise follow the delete.
        skipPendingEditNavigationBlockRef.current = true;
        clearPendingLiveEditState();
        clearPendingEditSessionMarker(id);
        void navigate("/home");
      })
      .catch((error) =>
        reportWriteFailure(error, {
          label: t("designEditor.fileMenu.deleteError"),
        }),
      );
  }, [
    clearPendingLiveEditState,
    deleteDesignMutation,
    id,
    navigate,
    queryClient,
    skipPendingEditNavigationBlockRef,
    t,
  ]);

  const briefs = useMemo(
    () => designBriefsFromData(design.data),
    [design.data],
  );

  if (titleEditing && canEditDesign) {
    return (
      <Input
        autoFocus
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitleEdit}
        onKeyDown={handleTitleInputKeyDown}
        className="-mx-1 h-7 min-w-0 flex-1 border-transparent bg-[var(--design-editor-panel-raised-bg)] px-1 py-0 text-[13px] font-medium text-foreground shadow-none ring-offset-0 focus-visible:border-[var(--design-editor-control-border)] focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
      />
    );
  }

  if (!canEditDesign) {
    if (briefs.length === 0) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="-mx-1 block truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90"
            >
              {design.title}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm break-words">
            <span>{design.title}</span>
          </TooltipContent>
        </Tooltip>
      );
    }
    // People who can only view the design get a menu with just the pages it
    // was built from.
    return (
      <>
        <BriefTitlesPrefetch briefs={briefs} />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="-mx-1 flex min-w-0 max-w-full cursor-pointer items-center gap-1 self-start rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
                >
                  <span className="truncate">{design.title}</span>
                  <IconChevronDown className="size-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-words">
              <span>{design.title}</span>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="start"
            className="design-editor-app-menu-content w-[220px]"
          >
            <BuiltFromItems briefs={briefs} />
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }

  return (
    <>
      <BriefTitlesPrefetch briefs={briefs} />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-mx-1 flex min-w-0 max-w-full cursor-pointer items-center gap-1 self-start rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-accent/50"
              >
                <span className="truncate">{design.title}</span>
                <IconChevronDown className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm break-words">
            <span>{design.title}</span>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          className="design-editor-app-menu-content w-[220px]"
          onCloseAutoFocus={(event) => {
            if (!suppressFileMenuReturnFocusRef.current) return;
            event.preventDefault();
            suppressFileMenuReturnFocusRef.current = false;
          }}
        >
          <BuiltFromItems briefs={briefs} />
          {briefs.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            onClick={() => {
              suppressFileMenuReturnFocusRef.current = true;
              setTitleDraft(design.title);
              setTitleEditing(true);
            }}
          >
            {t("designEditor.fileMenu.rename")}
          </DropdownMenuItem>
          {shouldShowFullDesignProjectMenu(widgetEmbed) ? (
            <>
              <DropdownMenuItem
                onClick={handleDuplicateDesign}
                disabled={duplicateDesignMutation.isPending}
              >
                {t("designEditor.fileMenu.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                {t("designEditor.fileMenu.versionHistory")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSaveTemplateOpen(true)}
                disabled={files.length === 0}
              >
                {t("designEditor.saveAsTemplate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openImportFilePicker}>
                {t("designEditor.fileMenu.import")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/visual-edit" target="_blank" rel="noreferrer">
                  {t("designEditor.fileMenu.connectLocalApp")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("designEditor.export")}
                </DropdownMenuSubTrigger>
                <ExportSubmenuContent
                  editorCore={editorCore}
                  editorGenerationAndAccess={editorGenerationAndAccess}
                  editorFilesAndSaving={editorFilesAndSaving}
                  editorActiveScreenAndGeometry={editorActiveScreenAndGeometry}
                  editorExportAndHandoff={editorExportAndHandoff}
                />
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setTrashDialogOpen(true)}
                disabled={!canShareDesign}
              >
                {t("designEditor.fileMenu.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={trashDialogOpen} onOpenChange={setTrashDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteDesignTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDesignDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              {t("home.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMoveToTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function renderProjectTitleControl(props: ProjectTitleControlProps) {
  return <ProjectTitleControl {...props} />;
}
