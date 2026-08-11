import { PromptComposer } from "@agent-native/core/client/composer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { IconAlertCircle, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import type { DesktopCreateAppResult } from "../../../shared/ipc-channels.js";

export interface CreateAppPromptPopoverProps {
  onCreated: (result: DesktopCreateAppResult) => void;
}

export default function CreateAppPromptPopover({
  onCreated,
}: CreateAppPromptPopoverProps) {
  const [open, setOpen] = useState(false);
  const [appsRoot, setAppsRoot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.electronAPI?.appConfig
      ?.getCreationSettings()
      .then((settings) => {
        if (!cancelled) setAppsRoot(settings.appsRoot);
      })
      .catch(() => {
        if (!cancelled) setAppsRoot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(rawPrompt: string) {
    const trimmed = rawPrompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.electronAPI?.appConfig?.createFromPrompt({
        prompt: trimmed,
      });
      if (!result) {
        setError("App creation is only available in Desktop.");
        return;
      }
      if (!result.ok || !result.app) {
        setError(result.error || result.message);
        return;
      }
      setOpen(false);
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label="Create app"
          title="Create app"
        >
          <IconPlus size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={10}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-3 shadow-xl"
        data-chat-first-create-app
      >
        <div className="space-y-3">
          <div className="space-y-1 px-1">
            <h2 className="text-sm font-semibold text-foreground">New app</h2>
            <p className="text-xs text-muted-foreground">
              Describe it. The request becomes a chat and the app is added to
              your workspace.
            </p>
          </div>
          <PromptComposer
            autoFocus
            disabled={submitting}
            placeholder="What should your app help with?"
            draftScope="desktop:chat-first:create-app"
            preserveDraftOnSubmit
            showModelSelector={false}
            modelStatusChecksEnabled={false}
            attachmentsEnabled={false}
            plusMenuMode="hidden"
            voiceEnabled={false}
            onSubmit={(text) => {
              void submit(text);
            }}
          />
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70">
            <IconPlus className="size-3.5" aria-hidden="true" />
            <span className="truncate">
              {appsRoot ? `Workspace: ${appsRoot}` : "Your default workspace"}
            </span>
            {submitting ? (
              <IconLoader2
                className="ml-auto size-3.5 shrink-0 animate-spin"
                aria-label="Creating app"
              />
            ) : null}
          </div>
          {error ? (
            <p
              className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
              role="alert"
            >
              <IconAlertCircle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
