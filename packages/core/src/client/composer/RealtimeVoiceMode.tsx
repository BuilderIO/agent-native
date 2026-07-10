import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconAlertTriangle,
  IconLoader2,
  IconMicrophone,
  IconPhoneOff,
  IconVolume,
} from "@tabler/icons-react";
import { useId, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";

export type RealtimeVoiceModeState =
  | "connecting"
  | "listening"
  | "speaking"
  | "working"
  | "error"
  | "ending";

/**
 * User-visible copy stays outside the shared component so host catalogs remain
 * the source of truth. Callers should provide these values through `useT()`.
 */
export interface RealtimeVoiceModeCopy {
  entryButtonLabel: string;
  promptTitle: string;
  promptDescription: string;
  startVoiceMode: string;
  keepDictating: string;
  showChat: string;
  hideChat: string;
  endVoiceMode: string;
  status: Record<RealtimeVoiceModeState, string>;
}

export interface RealtimeVoiceModeEntryProps {
  copy: RealtimeVoiceModeCopy;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStartVoiceMode: () => void;
  onKeepDictating: () => void;
  className?: string;
}

/**
 * Composer mic entry point for apps that support a full-duplex voice session.
 * The first click offers voice mode without silently changing the existing
 * editable-dictation behavior.
 */
export function RealtimeVoiceModeEntry({
  copy,
  disabled,
  open: controlledOpen,
  onOpenChange,
  onStartVoiceMode,
  onKeepDictating,
  className,
}: RealtimeVoiceModeEntryProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const titleId = useId();
  const descriptionId = useId();

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const choose = (callback: () => void) => {
    setOpen(false);
    callback();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={copy.entryButtonLabel}
              aria-expanded={open}
              className={cn(
                "size-7 shrink-0 text-muted-foreground hover:text-foreground",
                className,
              )}
            >
              <IconMicrophone />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{copy.entryButtonLabel}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="w-[min(22rem,calc(100vw-2rem))] p-4"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              {copy.promptTitle}
            </h2>
            <p
              id={descriptionId}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {copy.promptDescription}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => choose(onKeepDictating)}
            >
              {copy.keepDictating}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => choose(onStartVoiceMode)}
            >
              <IconMicrophone />
              {copy.startVoiceMode}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface RealtimeVoiceModeDockProps {
  state: RealtimeVoiceModeState;
  copy: RealtimeVoiceModeCopy;
  chatVisible: boolean;
  onToggleChat: () => void;
  onEndVoiceMode: () => void;
  errorMessage?: string | null;
  className?: string;
}

const ORB_STATE_CLASSES: Record<RealtimeVoiceModeState, string> = {
  connecting:
    "bg-secondary text-secondary-foreground ring-4 ring-secondary/40 hover:bg-secondary/80",
  listening:
    "bg-primary text-primary-foreground ring-4 ring-primary/15 hover:bg-primary/90",
  speaking:
    "bg-foreground text-background ring-4 ring-foreground/15 hover:bg-foreground/90",
  working:
    "bg-secondary text-secondary-foreground ring-4 ring-secondary/40 hover:bg-secondary/80",
  error:
    "bg-destructive text-destructive-foreground ring-4 ring-destructive/15 hover:bg-destructive/90",
  ending: "bg-muted text-muted-foreground ring-4 ring-muted/40 cursor-wait",
};

function VoiceStateIcon({ state }: { state: RealtimeVoiceModeState }) {
  switch (state) {
    case "connecting":
      return (
        <IconLoader2 className="animate-spin motion-reduce:animate-none" />
      );
    case "listening":
      return <IconMicrophone />;
    case "speaking":
      return <IconVolume />;
    case "working":
    case "ending":
      return (
        <IconLoader2 className="animate-spin motion-reduce:animate-none" />
      );
    case "error":
      return <IconAlertTriangle />;
  }
}

/**
 * Persistent voice-session control. Toggling the main orb only changes chat
 * visibility; ending the realtime session is intentionally a separate action.
 */
export function RealtimeVoiceModeDock({
  state,
  copy,
  chatVisible,
  onToggleChat,
  onEndVoiceMode,
  errorMessage,
  className,
}: RealtimeVoiceModeDockProps) {
  const statusId = useId();
  const toggleLabel = chatVisible ? copy.hideChat : copy.showChat;
  const ending = state === "ending";
  const errorDetailVisible = state === "error" && Boolean(errorMessage);

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 end-4 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2",
        className,
      )}
      data-realtime-voice-state={state}
    >
      {errorDetailVisible ? (
        <div
          role="alert"
          className="pointer-events-auto max-w-xs rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive shadow-md"
        >
          {errorMessage}
        </div>
      ) : null}

      <div
        id={statusId}
        role={state === "error" && !errorDetailVisible ? "alert" : "status"}
        aria-live={
          state === "error" && !errorDetailVisible ? "assertive" : "polite"
        }
        className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm"
      >
        {copy.status[state]}
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={ending}
              onClick={onEndVoiceMode}
              aria-label={copy.endVoiceMode}
              className="size-10 rounded-full bg-background shadow-md"
            >
              <IconPhoneOff />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.endVoiceMode}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              disabled={ending}
              onClick={onToggleChat}
              aria-label={toggleLabel}
              aria-pressed={chatVisible}
              aria-describedby={statusId}
              className={cn(
                "size-14 rounded-full shadow-lg",
                ORB_STATE_CLASSES[state],
              )}
            >
              <VoiceStateIcon state={state} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
