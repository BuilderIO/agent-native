import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconPlus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  PromptComposer,
  useAgentChatGenerating,
  useSendToAgentChat,
} from "@agent-native/core/client";

type NewCompositionPopoverProps = {
  isNew: boolean;
  onNavigate: (path: string) => void;
  onGeneratingChange?: (generating: boolean) => void;
};

export function NewCompositionPopover({
  isNew,
  onNavigate,
  onGeneratingChange,
}: NewCompositionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { send, codeRequiredDialog } = useSendToAgentChat();

  const [agentGenerating] = useAgentChatGenerating();

  // Auto-save after the agent finishes generating a new composition
  useEffect(() => {
    if (agentGenerating || !isGenerating) return;
    setIsGenerating(false);
    onGeneratingChange?.(false);
    setTimeout(() => {
      const match = window.location.pathname.match(/\/c\/([^\/]+)/);
      if (match && match[1] !== "new") {
        try {
          window.dispatchEvent(
            new CustomEvent("videos.auto-save", {
              detail: { compositionId: match[1] },
            }),
          );
        } catch (error) {
          console.error("[AI Auto-Save] Failed:", error);
        }
      }
    }, 2000);
  }, [agentGenerating, isGenerating, onGeneratingChange]);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit(text: string, files: File[]) {
    const trimmed = text.trim();
    if (!trimmed) return;

    let context =
      "The user wants to generate a new Remotion video composition. Help them create the component, register it, and set up tracks.";

    const allowed = files.filter(
      (f) => f.type.match(/^(image|video)\//) || f.name.endsWith(".svg"),
    );
    if (allowed.length > 0) {
      const attachments = await Promise.all(
        allowed.map(async (f) => ({
          name: f.name,
          path: await fileToDataUrl(f),
        })),
      );
      context +=
        "\n\nAttached files:\n" +
        attachments.map((a) => `- ${a.name}: ${a.path}`).join("\n");
    }

    const result = send({
      message: trimmed,
      context,
      submit: true,
      requiresCode: true,
    });
    if (result === null) return;

    setIsGenerating(true);
    onGeneratingChange?.(true);
    setOpen(false);
    onNavigate("/c/new");
  }

  return (
    <>
      {codeRequiredDialog}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs font-medium transition-all",
              isNew
                ? "border-primary/40 bg-primary/8 text-primary"
                : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary/80 hover:bg-primary/5",
            )}
          >
            <IconPlus size={14} />
            New Composition
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[calc(100vw-2rem)] max-w-[420px] rounded-xl border-border bg-card p-3 shadow-xl sm:w-[420px]"
        >
          <div className="mb-2 px-1">
            <h3 className="text-sm font-semibold text-foreground">
              New composition
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Describe the video you want to create
            </p>
          </div>
          <PromptComposer
            autoFocus
            attachmentsEnabled
            placeholder="Describe the video you want to create..."
            draftScope="videos:new-composition"
            onSubmit={handleSubmit}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
