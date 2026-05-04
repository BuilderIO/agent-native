import { useState, type ReactNode } from "react";
import { sendToAgentChat, PromptComposer } from "@agent-native/core/client";
import { IconPlus } from "@tabler/icons-react";
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

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: trimmed,
      context: SUBMIT_CONTEXT,
      submit: true,
      newTab: true,
    });
    setOpen(false);
  }

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
        className="w-[calc(100vw-2rem)] rounded-xl p-3 shadow-xl sm:w-[420px]"
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          Create app
        </p>
        <PromptComposer
          autoFocus
          placeholder="Describe the app you want to build…"
          draftScope="dispatch:create-app-popover"
          onSubmit={(text) => submit(text)}
        />
      </PopoverContent>
    </Popover>
  );
}
