import { useEffect, useRef, useState, type ReactNode } from "react";
import { sendToAgentChat } from "@agent-native/core/client";
import { IconArrowUp, IconPlus } from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CreateAppPopoverProps {
  /**
   * Custom trigger element. Defaults to a dashed-border tile that matches the
   * apps grid empty state.
   */
  trigger?: ReactNode;
  /**
   * Override the popover alignment. Defaults to "center" with a 10px offset.
   */
  align?: "start" | "center" | "end";
}

const SUBMIT_CONTEXT =
  "The user wants to create a new workspace app. Use the start-workspace-app-creation action with their description above to scaffold the app, then continue with whatever the action returns.";

export function CreateAppPopover({
  trigger,
  align = "center",
}: CreateAppPopoverProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  function submit() {
    const text = prompt.trim();
    if (!text) return;
    sendToAgentChat({
      message: text,
      context: SUBMIT_CONTEXT,
      submit: true,
      newTab: true,
    });
    setPrompt("");
    setOpen(false);
  }

  const submitShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
      ? "⌘"
      : "Ctrl";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex min-h-32 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-card p-4 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <IconPlus size={16} />
              Create app
            </span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={10}
        className="w-[calc(100vw-2rem)] rounded-xl p-4 shadow-xl sm:w-96"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          <p className="text-sm font-semibold text-foreground">Create app</p>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Describe the app you want to build…"
            rows={5}
            className="flex min-h-[140px] w-full resize-y rounded-md border border-input bg-background px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-[11px] text-muted-foreground/75">
              {submitShortcut}+Enter to submit
            </span>
            <button
              type="submit"
              disabled={!prompt.trim()}
              aria-label="Submit prompt"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
