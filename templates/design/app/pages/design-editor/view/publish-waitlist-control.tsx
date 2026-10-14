import {
  IconPlayerPlay,
  IconChevronDown,
  IconArrowUpRight,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCanvasAndScreens } from "../domains/use-editor-canvas-and-screens";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorLayerActions } from "../domains/use-editor-layer-actions";
import type { EditorScreenInspector } from "../domains/use-editor-screen-inspector";

export function PublishWaitlistPanel({
  editorCore,
  editorLayerActions,
  onClose,
}: {
  editorCore: EditorCore;
  editorLayerActions: EditorLayerActions;
  onClose: () => void;
}) {
  const { isSignedIn } = editorCore;
  const {
    publishWaitlistJoined,
    publishWaitlistError,
    handleJoinPublishWaitlist,
    joiningPublishWaitlist,
  } = editorLayerActions;

  return (
    <>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {
            publishWaitlistJoined
              ? "You're on the waitlist" /* i18n-ignore */
              : "Publish app" /* i18n-ignore */
          }
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {
            publishWaitlistJoined
              ? "We'll follow up when app publishing is ready for your workspace." /* i18n-ignore */
              : isSignedIn
                ? "Publish directly from Design is opening soon. Want early access?" /* i18n-ignore */
                : "Publish directly from Design is opening soon. Sign in to join the waitlist." /* i18n-ignore */
          }
        </p>
      </div>
      {publishWaitlistError ? (
        <p role="alert" className="text-xs text-destructive">
          {publishWaitlistError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={onClose}
        >
          {
            publishWaitlistJoined
              ? "Done" /* i18n-ignore */
              : "Not now" /* i18n-ignore */
          }
        </Button>
        {!publishWaitlistJoined && (
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() => void handleJoinPublishWaitlist()}
            disabled={joiningPublishWaitlist}
          >
            {joiningPublishWaitlist ? (
              <>
                <Spinner className="mr-1.5 size-3.5" />
                {"Joining" /* i18n-ignore */}
              </>
            ) : isSignedIn ? (
              "Add me to waitlist" /* i18n-ignore */
            ) : (
              "Sign in to join" /* i18n-ignore */
            )}
          </Button>
        )}
      </div>
    </>
  );
}

export function renderPublishWaitlistControl({
  editorCore,
  editorGenerationAndAccess,
  editorActiveScreenAndGeometry,
  editorCanvasAndScreens,
  editorScreenInspector,
  editorLayerActions,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorCanvasAndScreens: EditorCanvasAndScreens;
  editorScreenInspector: EditorScreenInspector;
  editorLayerActions: EditorLayerActions;
}) {
  const { hostEmbeddedEditor, t } = editorCore;
  const {
    publishWaitlistPopoverOpen,
    setPublishWaitlistPopoverOpen,
    setPublishWaitlistPopoverView,
    publishWaitlistPopoverView,
  } = editorGenerationAndAccess;
  const { activeScreenSnapshotOnly } = editorActiveScreenAndGeometry;
  const { activeContent } = editorCanvasAndScreens;
  const { handleOpenDesignPreview, activeScreenPreviewUrl } =
    editorScreenInspector;
  const { setPublishWaitlistError } = editorLayerActions;

  return (
    <Popover
      open={hostEmbeddedEditor ? false : publishWaitlistPopoverOpen}
      onOpenChange={(open) => {
        setPublishWaitlistPopoverOpen(open);
        setPublishWaitlistPopoverView("actions");
        if (open) {
          setPublishWaitlistError(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-[var(--design-row-height)] cursor-pointer gap-[var(--design-baseline-half)] rounded-md px-[var(--design-baseline-unit)] text-foreground hover:bg-accent hover:text-foreground",
                hostEmbeddedEditor && "hidden",
              )}
              aria-label={"Preview or publish app" /* i18n-ignore */}
            >
              <IconPlayerPlay className="size-5" />
              <IconChevronDown className="size-3 opacity-70" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {"Preview or publish app" /* i18n-ignore */}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[100010] w-72 space-y-3 p-3"
      >
        {publishWaitlistPopoverView === "actions" ? (
          <div className="space-y-1">
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => {
                if (activeScreenSnapshotOnly) return;
                handleOpenDesignPreview();
                setPublishWaitlistPopoverOpen(false);
              }}
              disabled={
                activeScreenSnapshotOnly ||
                (!activeScreenPreviewUrl && !activeContent.trim())
              }
            >
              <IconPlayerPlay className="size-4" />
              {t("designEditor.designPreview")}
            </Button>
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => setPublishWaitlistPopoverView("waitlist")}
            >
              <IconArrowUpRight className="size-4" />
              {"Publish app" /* i18n-ignore */}
            </Button>
          </div>
        ) : (
          <PublishWaitlistPanel
            editorCore={editorCore}
            editorLayerActions={editorLayerActions}
            onClose={() => setPublishWaitlistPopoverOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
