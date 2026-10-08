import { CreativeContextShareTab } from "@agent-native/creative-context/client";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import { PresenceBar } from "@agent-native/toolkit/collab-ui";
import {
  IconCode,
  IconPhoto,
  IconArchive,
  IconCheck,
  IconDownload,
  IconTerminal2,
  IconClipboard,
  IconMessageCircle,
  IconLink,
  IconExternalLink,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { type ShareExportFormat } from "../command-types";
import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import type { EditorLayerModels } from "../domains/use-editor-layer-models";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorScreenInspector } from "../domains/use-editor-screen-inspector";
import type { EditorScreenRendering } from "../domains/use-editor-screen-rendering";
import {
  LOCALHOST_WRITE_EXTENSIONS,
  LOCALHOST_COMPILED_SOURCE_EXTENSIONS,
  NO_LOCALHOST_WRITE_CONTENT_MESSAGE,
} from "../editor-constants";
import { resolveLocalhostSourceWriteContent } from "../editor-state";
import { mergePresenceUsers } from "../presence-users";
import type { DesignData } from "../types";

export function renderRightSidebarActions({
  editorCore,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorLiveEditsAndPresence,
  editorExportAndHandoff,
  editorLayerModels,
  editorScreenInspector,
  editorLayerActions,
  editorScreenRendering,
  id,
  design,
  signInToShareHref,
  renderZoomControl,
  signedOutPersistenceActions,
  pendingNodeRewriteControl,
  publishWaitlistControl,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorLayerModels: EditorLayerModels;
  editorScreenInspector: EditorScreenInspector;
  editorLayerActions: EditorLayerActions;
  editorScreenRendering: EditorScreenRendering;
  id: string;
  design: DesignData;
  signInToShareHref: string;
  renderZoomControl: (controlId: "toolbar" | "inspector") => ReactElement;
  signedOutPersistenceActions: ReactElement;
  pendingNodeRewriteControl: ReactElement | null;
  publishWaitlistControl: ReactElement;
}) {
  const { t, sessionResolved, isSignedIn, hostEmbeddedEditor, viewMode } =
    editorCore;
  const {
    canShareDesign,
    exportHtmlMutation,
    exportZipMutation,
    canEditDesign,
    liveCollaborationSaving,
    liveCollaborationEnabled,
    handleLiveCollaborationChange,
    reviewAgentQueueCount,
    handleApplyReviewFeedback,
    reviewFeedbackApplying,
    canRenderAuthenticatedShare,
  } = editorGenerationAndAccess;
  const {
    postAuthIntent,
    hasLocalhostScreens,
    creativeContextEnabled,
    editorShareUrl,
  } = editorFilesAndSaving;
  const { activeFile, activeScreenSnapshotOnly } =
    editorActiveScreenAndGeometry;
  const {
    activeContent,
    currentUser,
    activeUsers,
    overviewActiveUsers,
    agentPresent,
    overviewAgentPresent,
    agentActive,
    overviewAgentActive,
  } = editorCanvasAndScreens;
  const { followingEmail, handleAvatarClick } = editorLiveEditsAndPresence;
  const {
    handleDownloadHtml,
    pngExporting,
    handleDownloadPng,
    svgExporting,
    handleDownloadSvg,
    handleDownloadZip,
    handleCopyCodingHandoff,
    codingHandoffLoading,
  } = editorExportAndHandoff;
  const { shareExportFormat, setShareExportFormat, codingHandoffPreviewText } =
    editorLayerModels;
  const { activeScreenPreviewUrl } = editorScreenInspector;
  const {
    activeLocalhostRelPath,
    activeScreenIsLocalSource,
    activeLocalhostSourceSnapshotHtml,
  } = editorLayerActions;
  const { applyToSourcePending, handleApplyToSource } = editorScreenRendering;

  const shouldOpenShare = postAuthIntent === "share" && canShareDesign;

  const shareExportOptions: Array<{
    value: ShareExportFormat;
    title: string;
    extension: string;
    // guard:allow-required-description - every export format option ships its own description
    description: string;
    Icon: typeof IconCode;
    disabled: boolean;
    onDownload: () => void;
  }> = [
    {
      value: "html",
      title: "Standalone HTML" /* i18n-ignore share export format */,
      extension: ".html",
      description:
        // i18n-ignore share export description
        "One self-contained file that works offline.",
      Icon: IconCode,
      disabled: !activeFile || exportHtmlMutation.isPending,
      onDownload: handleDownloadHtml,
    },
    {
      value: "png",
      title: "PNG image" /* i18n-ignore share export format */,
      extension: ".png",
      description:
        // i18n-ignore share export description
        "Snapshot of the current screen.",
      Icon: IconPhoto,
      disabled: !activeFile || pngExporting,
      onDownload: () => void handleDownloadPng(),
    },
    {
      value: "svg",
      title: "SVG image" /* i18n-ignore share export format */,
      extension: ".svg",
      description:
        // i18n-ignore share export description
        "Scalable snapshot of the current screen.",
      Icon: IconCode,
      disabled: !activeFile || svgExporting,
      onDownload: () => void handleDownloadSvg(),
    },
    {
      value: "zip",
      title: "Project archive" /* i18n-ignore share export format */,
      extension: ".zip",
      description:
        // i18n-ignore share export description
        "Every file in this design, zipped.",
      Icon: IconArchive,
      disabled: !activeFile || exportZipMutation.isPending,
      onDownload: handleDownloadZip,
    },
  ];
  const selectedShareExportOption =
    shareExportOptions.find((option) => option.value === shareExportFormat) ??
    shareExportOptions[0];
  const shareExportTab = (
    <div className="space-y-3">
      <div className="!text-[11px] font-semibold uppercase text-muted-foreground">
        {"Format" /* i18n-ignore share export section label */}
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shareExportOptions.map((option) => {
          const selected = option.value === shareExportFormat;
          const ExportIcon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setShareExportFormat(option.value)}
              className={cn(
                "relative flex min-h-[76px] items-start gap-2.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-2.5 text-left transition-colors hover:bg-[var(--design-editor-panel-raised-bg)]",
                selected
                  ? "bg-[var(--design-editor-panel-raised-bg)] ring-1 ring-[var(--design-editor-accent-color)]"
                  : "",
              )}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--design-editor-panel-raised-bg)] text-muted-foreground">
                <ExportIcon className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-foreground">
                  {option.title}{" "}
                  <span className="!text-[11px] font-medium text-muted-foreground">
                    {option.extension}
                  </span>
                </span>
                <span className="mt-0.5 block !text-[11px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute right-2.5 top-2.5 inline-flex size-4 items-center justify-center rounded-full border",
                  selected
                    ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)]"
                    : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)]",
                )}
              >
                {selected ? <IconCheck className="size-3" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-foreground">
            {selectedShareExportOption.title}
          </div>
          <div className="!text-[11px] text-muted-foreground">
            {selectedShareExportOption.description}
          </div>
        </div>
        <Button
          type="button"
          onClick={selectedShareExportOption.onDownload}
          disabled={selectedShareExportOption.disabled}
          className="h-8 gap-1.5 rounded-md bg-[var(--design-editor-accent-color)] px-3 text-[12px] text-[var(--design-editor-accent-contrast-color)] shadow-none hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] disabled:bg-muted disabled:text-muted-foreground"
        >
          <IconDownload className="size-3.5" />
          {"Download" /* i18n-ignore share export action */}
        </Button>
      </div>
    </div>
  );
  const shareSendToTab = (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-8 items-center border-b border-neutral-800 px-3">
          <div className="flex items-center gap-2">
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-red-500" />
            <span className="size-2.5 rounded-full bg-yellow-400" />
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-3.5 text-neutral-500" />
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void handleCopyCodingHandoff()}
          disabled={codingHandoffLoading}
          className="h-8 gap-1.5 rounded-md px-3 text-[12px]"
        >
          <IconClipboard className="size-3.5" />
          {"Copy agent prompt" /* i18n-ignore share send action */}
        </Button>
      </div>
    </div>
  );
  const designSharePopoverClassName =
    "z-[100010] !w-[min(620px,calc(100vw-32px))] !p-3 " +
    "[&_[role=tablist]]:!inline-flex [&_[role=tablist]]:!w-fit [&_[role=tablist]]:!max-w-full [&_[role=tablist]]:!self-start [&_[role=tablist]]:!overflow-x-auto [&_[role=tablist]]:justify-start [&_[role=tablist]]:gap-1 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border [&_[role=tablist]]:border-[var(--design-editor-panel-divider-color)] [&_[role=tablist]]:bg-[var(--design-editor-panel-raised-bg)] [&_[role=tablist]]:p-1 " +
    "[&_[role=tab]]:!h-8 [&_[role=tab]]:!flex-none [&_[role=tab]]:rounded-md [&_[role=tab]]:px-3 [&_[role=tab]]:!text-[12px] [&_[role=tab]]:font-semibold [&_[role=tab]]:shadow-none [&_[role=tab]]:ring-0 " +
    "[&_[role=tab]:hover]:text-foreground " +
    "[&_[role=tab][aria-selected=true]]:!bg-background dark:[&_[role=tab][aria-selected=true]]:!bg-[var(--design-editor-panel-bg)] [&_[role=tab][aria-selected=true]]:text-foreground";
  const designShareTabs = {
    shareLabel: "Share link" /* i18n-ignore share tab label */,
    defaultValue: "share",
    tabs: [
      {
        value: "export",
        label: t("designEditor.export"),
        content: shareExportTab,
      },
      {
        value: "send",
        label: "Send to agent" /* i18n-ignore share tab label */,
        content: shareSendToTab,
      },
      ...(hasLocalhostScreens &&
      sessionResolved &&
      (!isSignedIn || canEditDesign)
        ? [
            {
              value: "live-collaboration",
              label: t("designEditor.liveCollaboration.title"),
              content: isSignedIn ? (
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {t("designEditor.liveCollaboration.title")}
                    </div>
                    {liveCollaborationSaving ? (
                      <p className="text-xs text-muted-foreground">
                        {t("designEditor.liveCollaboration.saving")}
                      </p>
                    ) : null}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Switch
                        checked={liveCollaborationEnabled}
                        disabled={liveCollaborationSaving}
                        aria-label={t("designEditor.liveCollaboration.title")}
                        onCheckedChange={(enabled) =>
                          void handleLiveCollaborationChange(enabled)
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("designEditor.liveCollaboration.description")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex justify-end py-1">
                  <Button asChild size="sm">
                    <a href={signInToShareHref}>
                      {t("designEditor.signUpToShareLiveCanvas")}
                    </a>
                  </Button>
                </div>
              ),
            },
          ]
        : []),
      ...(creativeContextEnabled
        ? [
            {
              value: "context",
              label: t("creativeContext.share.tabLabel", {
                defaultValue: "Context",
              }),
              content: (
                <CreativeContextShareTab
                  resource={{
                    appId: "design",
                    resourceType: "design",
                    resourceId: id ?? "",
                    title: design?.title ?? "Untitled design",
                    updatedAt: design?.updatedAt ?? undefined,
                    preview: { kind: "document", label: "Design project" }, // i18n-ignore share-tab preview descriptor, template pages are raw-English
                  }}
                />
              ),
            },
          ]
        : []),
    ],
  };

  const activeLocalhostWriteExtension =
    (activeLocalhostRelPath?.match(/\.[^.]+$/) ?? [])[0]?.toLowerCase() ?? "";
  const activeLocalhostRouteIsWritable =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_WRITE_EXTENSIONS.has(activeLocalhostWriteExtension);
  const activeLocalhostSourceWriteContent = resolveLocalhostSourceWriteContent({
    extension: activeLocalhostWriteExtension,
    persistedContent: activeContent,
    liveSnapshotHtml: activeLocalhostSourceSnapshotHtml,
  });
  const activeLocalhostRouteIsCompiledSource =
    activeScreenIsLocalSource &&
    Boolean(activeLocalhostRelPath) &&
    LOCALHOST_COMPILED_SOURCE_EXTENSIONS.has(activeLocalhostWriteExtension);

  return (
    <div
      data-design-chrome-region="right-toolbar"
      className="shrink-0 border-b border-border bg-[var(--design-editor-panel-bg)] px-[var(--design-baseline-unit)] py-[var(--design-baseline-half)]"
    >
      <div
        data-design-chrome-region="right-toolbar-actions"
        className="flex min-h-[var(--design-row-height)] items-center gap-[var(--design-baseline-half)]"
      >
        <div className="flex min-w-0 flex-1 items-center gap-[var(--design-baseline-half)]">
          {hostEmbeddedEditor ? null : (
            <>
              <PresenceBar
                activeUsers={mergePresenceUsers(
                  currentUser ? [currentUser] : [],
                  activeUsers,
                  overviewActiveUsers,
                )}
                agentPresent={agentPresent || overviewAgentPresent}
                agentActive={agentActive || overviewAgentActive}
                currentUserEmail={currentUser?.email}
                showCurrentUser
                followingEmail={followingEmail}
                onAvatarClick={handleAvatarClick}
                disableAgentClick
                className="shrink-0"
              />
              {sessionResolved && !isSignedIn ? publishWaitlistControl : null}
            </>
          )}
        </div>

        {/* Not shrink-0: the signed-out CTA ("Sign up") is a
            nowrap label wide enough to push this row past the right rail's
            edge on its own, and a shrink-0 row has no way to give that space
            back — it just overflows the panel. */}
        <div className="flex min-w-0 shrink items-center gap-[var(--design-baseline-half)]">
          {pendingNodeRewriteControl}
          {canEditDesign && reviewAgentQueueCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-[var(--design-row-height)] gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-xs"
              onClick={handleApplyReviewFeedback}
              disabled={reviewFeedbackApplying}
            >
              {reviewFeedbackApplying ? (
                <Spinner className="size-3.5" />
              ) : (
                <IconMessageCircle className="size-3.5" />
              )}
              {reviewFeedbackApplying
                ? t("review.applyingFeedback")
                : t("review.applyFeedback", { count: reviewAgentQueueCount })}
            </Button>
          ) : null}
          {!sessionResolved || isSignedIn ? publishWaitlistControl : null}

          {hostEmbeddedEditor ? null : canRenderAuthenticatedShare ? (
            <ShareButton
              resourceType="design"
              resourceId={id}
              resourceTitle={design.title}
              hideTriggerIcon
              defaultOpen={shouldOpenShare}
              shareUrl={editorShareUrl}
              shareUrlLabel={t(
                hasLocalhostScreens
                  ? "designEditor.liveCanvasLink"
                  : "designEditor.shareEditorLink",
              )}
              shareUrlDescription={t("designEditor.shareEditorLinkDescription")}
              roleCopy={{
                commenter: {
                  label: t("designEditor.commenterRoleLabel"),
                  description: t("designEditor.commenterRoleDescription"),
                },
              }}
              shareTabs={designShareTabs}
              popoverClassName={designSharePopoverClassName}
              triggerClassName="h-[var(--design-row-height)] rounded-md !border-[var(--design-editor-accent-color)] !bg-[var(--design-editor-accent-color)] px-[calc(var(--design-baseline-unit)*1.5)] text-sm !text-[var(--design-editor-accent-contrast-color)] shadow-none hover:!border-[var(--design-editor-accent-hover-color)] hover:!bg-[var(--design-editor-accent-hover-color)] hover:!text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)] [&_svg]:!text-[var(--design-editor-accent-contrast-color)]"
            />
          ) : sessionResolved ? (
            signedOutPersistenceActions
          ) : null}
        </div>
      </div>
      {activeScreenIsLocalSource &&
      viewMode === "single" &&
      !activeScreenSnapshotOnly &&
      activeScreenPreviewUrl ? (
        <div className="mt-[var(--design-baseline-half)] flex h-[var(--design-row-height)] min-w-0 items-center gap-[var(--design-baseline-half)]">
          <a
            href={activeScreenPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[var(--design-control-height)] min-w-0 flex-1 items-center gap-[var(--design-baseline-half)] rounded-md border border-border bg-[var(--design-editor-panel-raised-bg)] px-[var(--design-baseline-unit)] text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={"Open local preview" /* i18n-ignore */}
            title={activeScreenPreviewUrl}
          >
            <IconLink className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono">
              {activeScreenPreviewUrl}
            </span>
            <IconExternalLink className="size-3 shrink-0" />
          </a>
          {(activeLocalhostRouteIsWritable ||
            activeLocalhostRouteIsCompiledSource) &&
          canEditDesign &&
          id ? (
            activeLocalhostRouteIsCompiledSource ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-[var(--design-control-height)]"
                      disabled
                      aria-label={t("designEditor.applyToSource")}
                    >
                      <IconDeviceFloppy className="size-3" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("designEditor.applyToSourceUnavailableCompiled")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-[var(--design-control-height)]"
                    disabled={
                      applyToSourcePending || !activeLocalhostSourceWriteContent
                    }
                    aria-label={
                      applyToSourcePending
                        ? t("designEditor.writingToSource")
                        : t("designEditor.applyToSource")
                    }
                    onClick={handleApplyToSource}
                  >
                    {applyToSourcePending ? (
                      <Spinner className="size-3" />
                    ) : (
                      <IconDeviceFloppy className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {!activeLocalhostSourceWriteContent
                    ? NO_LOCALHOST_WRITE_CONTENT_MESSAGE
                    : activeLocalhostRelPath
                      ? t("designEditor.applyToSourcePath", {
                          path: activeLocalhostRelPath,
                        })
                      : t("designEditor.applyToSource")}
                </TooltipContent>
              </Tooltip>
            )
          ) : null}
        </div>
      ) : null}
      {/* Zoom sits here rather than in the inspector tab row below: sharing
          that row truncated the "Comments" tab label at normal panel widths. */}
      <div className="mt-[var(--design-baseline-half)] flex h-[var(--design-row-height)] min-w-0 flex-nowrap items-center gap-[var(--design-baseline-half)]">
        <div className="shrink-0">{renderZoomControl("inspector")}</div>
      </div>
    </div>
  );
}
