import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconClipboard,
  IconChevronDown,
  IconMessageCircle,
} from "@tabler/icons-react";
import { useState } from "react";

import { useAgentEditRequest } from "@/hooks/useAgentEditRequest";
import { cn } from "@/lib/utils";

export interface InspectorAiActionsProps {
  /** CSS selector for the currently-selected element, if any. */
  selector?: string;
  /** Source id (data-code-layer-id) of the selected element, if any. */
  sourceId?: string;
  /** Active file id. */
  fileId?: string;
  /** Active file name (e.g. "index.html"). */
  filename?: string;
  /** Localhost-backed source file, when the selected screen comes from a local app. */
  routeSourceFile?: string;
  /** The design id. */
  designId?: string;
  /** When false, the controls are disabled. */
  canEdit: boolean;
}

/**
 * Compact inspector block that lets the user type a freeform AI edit request
 * and either route it to the agent chat sidebar ("Apply with AI") or copy the
 * prompt to the clipboard ("Copy prompt").
 *
 * Collapsed by default to keep the inspector clean.
 */
export function InspectorAiActions({
  selector,
  sourceId,
  fileId,
  filename,
  routeSourceFile,
  designId,
  canEdit,
}: InspectorAiActionsProps) {
  const t = useT();
  const { sendEdit, copyPrompt } = useAgentEditRequest();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");

  const args = {
    message: request,
    selector,
    sourceId,
    fileId,
    filename,
    routeSourceFile,
    designId,
  };
  const copyDisabled = !request.trim();
  const askDisabled = !canEdit || copyDisabled;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
          )}
        >
          <span className="flex items-center gap-1.5">
            <IconMessageCircle className="size-3.5 shrink-0" />
            {t("designEditor.localSourceEdit.askAi")}
          </span>
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
        <div className="flex flex-col gap-2 px-1 pb-2 pt-1">
          <Textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder={
              selector
                ? t("designEditor.localSourceEdit.describeElementChange")
                : t("designEditor.localSourceEdit.describeChange")
            }
            className="min-h-[64px] resize-none text-xs"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                !askDisabled
              ) {
                e.preventDefault();
                void sendEdit(args);
                setRequest("");
                setOpen(false);
              }
            }}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="default"
              className="flex-1 gap-1.5 text-xs"
              disabled={askDisabled}
              onClick={() => {
                void sendEdit(args);
                setRequest("");
                setOpen(false);
              }}
            >
              <IconMessageCircle className="size-3.5 shrink-0" />
              {t("designEditor.localSourceEdit.applyWithAi")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              disabled={copyDisabled}
              onClick={() => {
                void copyPrompt(args);
              }}
              title={t("designEditor.localSourceEdit.copyPromptTooltip")}
            >
              <IconClipboard className="size-3.5 shrink-0" />
              {t("designEditor.localSourceEdit.copyPrompt")}
            </Button>
          </div>
          {selector && (
            <p className="text-[10px] leading-tight text-muted-foreground truncate">
              {t("designEditor.localSourceEdit.targeting")}{" "}
              <code className="font-mono">{selector}</code>
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
