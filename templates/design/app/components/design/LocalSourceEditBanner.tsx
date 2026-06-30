import { useT } from "@agent-native/core/client";
import {
  IconInfoCircle,
  IconMessageBolt,
  IconClipboard,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAgentEditRequest } from "@/hooks/useAgentEditRequest";

export interface LocalSourceEditBannerProps {
  /** The design id for agent context. */
  designId: string;
  /** The active file id for agent context, if known. */
  fileId?: string;
  /** Path to the localhost source file that should receive edits, if known. */
  routeSourceFile?: string;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
}

/**
 * Dismissible informational banner shown for screens connected to a local
 * source (localhost / React dev server). Explains that edits are routed
 * through the AI agent rather than applied directly, and provides quick
 * "Ask AI to edit" and "Copy prompt" affordances.
 */
export function LocalSourceEditBanner({
  designId,
  fileId,
  routeSourceFile,
  onDismiss,
}: LocalSourceEditBannerProps) {
  const t = useT();
  const { sendEdit, copyPrompt } = useAgentEditRequest();
  const [promptOpen, setPromptOpen] = useState(false);
  const [request, setRequest] = useState("");

  const baseArgs = { designId, fileId, routeSourceFile };
  const submitArgs = { ...baseArgs, message: request };
  const trimmed = request.trim();

  return (
    <>
      <Alert className="relative flex items-start gap-2 rounded-none border-x-0 border-t-0 py-2 px-3 text-xs">
        <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <AlertDescription className="flex flex-1 flex-col gap-1.5 text-xs leading-snug">
          <span>{t("designEditor.localSourceEdit.bannerNotice")}</span>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => setPromptOpen(true)}
            >
              <IconMessageBolt className="size-3 shrink-0" />
              {t("designEditor.localSourceEdit.askAiToEdit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => {
                void copyPrompt({
                  ...baseArgs,
                  message: routeSourceFile
                    ? `Edit the connected source file "${routeSourceFile}" as requested.`
                    : "Edit the connected source code as requested.",
                });
              }}
            >
              <IconClipboard className="size-3 shrink-0" />
              {t("designEditor.localSourceEdit.copyPrompt")}
            </Button>
          </div>
        </AlertDescription>
        {onDismiss && (
          <button
            type="button"
            aria-label={t("designEditor.dismiss")}
            onClick={onDismiss}
            className="absolute end-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <IconX className="size-3.5" />
          </button>
        )}
      </Alert>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("designEditor.localSourceEdit.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {routeSourceFile
                ? t("designEditor.localSourceEdit.dialogDescriptionFile", {
                    file: routeSourceFile,
                  })
                : t("designEditor.localSourceEdit.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder={t("designEditor.localSourceEdit.requestPlaceholder")}
            className="min-h-[96px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmed) {
                e.preventDefault();
                void sendEdit(submitArgs);
                setRequest("");
                setPromptOpen(false);
              }
            }}
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void copyPrompt(submitArgs);
              }}
              disabled={!trimmed}
            >
              <IconClipboard className="size-4" />
              {t("designEditor.localSourceEdit.copyPrompt")}
            </Button>
            <Button
              onClick={() => {
                void sendEdit(submitArgs);
                setRequest("");
                setPromptOpen(false);
              }}
              disabled={!trimmed}
            >
              <IconMessageBolt className="size-4" />
              {t("designEditor.localSourceEdit.askAiToEdit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
