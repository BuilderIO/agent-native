import { useState, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, ArrowUp, X, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core/client";

type NewCompositionPopoverProps = {
  isNew: boolean;
  onNavigate: (path: string) => void;
  onGeneratingChange?: (generating: boolean) => void;
};

type Attachment = {
  name: string;
  path: string; // data URL
};

export function NewCompositionPopover({ isNew, onNavigate, onGeneratingChange }: NewCompositionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus prompt when popover opens
  useEffect(() => {
    if (open) {
      setPrompt("");
      setAttachments([]);
      setTimeout(() => promptRef.current?.focus(), 50);
    }
  }, [open]);

  // Listen for generation completion and auto-save
  const [agentGenerating] = useAgentChatGenerating();

  useEffect(() => {
    if (!agentGenerating && isGenerating) {
      setIsGenerating(false);
      onGeneratingChange?.(false);

      // Auto-save after AI generation completes
      setTimeout(async () => {
        const currentPath = window.location.pathname;
        const match = currentPath.match(/\/c\/([^\/]+)/);

        if (match && match[1] !== "new") {
          const compositionId = match[1];
          console.log('[AI Auto-Save] Saving changes for:', compositionId);

          try {
            window.dispatchEvent(new CustomEvent('videos.auto-save', {
              detail: { compositionId }
            }));
          } catch (error) {
            console.error('[AI Auto-Save] Failed:', error);
          }
        }
      }, 2000); // Wait 2 seconds for localStorage and state to settle
    }
  }, [agentGenerating, isGenerating, onGeneratingChange]);

  const submitChat = () => {
    if (!prompt.trim()) return;

    // Build context with attachment references
    let context = "The user wants to generate a new Remotion video composition. Help them create the component, register it, and set up tracks.";
    if (attachments.length > 0) {
      context += "\n\nAttached files:\n" +
        attachments.map((a) => `- ${a.name}: ${a.path}`).join("\n");
    }

    // Send to agent chat via @agent-native/core
    sendToAgentChat({
      message: prompt.trim(),
      context,
      submit: true,
    });

    console.log('[NewComposition] Sent to agent chat:', { message: prompt.trim(), attachments: attachments.length });

    // Update state
    setIsGenerating(true);
    onGeneratingChange?.(true);
    setOpen(false);
    setPrompt("");
    setAttachments([]);
    
    // Navigate to /c/new for loading state
    onNavigate("/c/new");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Only allow images, videos, and SVGs
      if (!file.type.match(/^(image|video)\//) && !file.name.endsWith('.svg')) {
        continue;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newAttachments.push({
          name: file.name,
          path: dataUrl,
        });
      } catch (error) {
        console.error('Failed to read file:', file.name, error);
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, [prompt]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed transition-all text-xs font-medium",
            isNew
              ? "border-primary/40 bg-primary/8 text-primary"
              : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary/80 hover:bg-primary/5",
          )}
        >
          <Plus size={14} />
          New Composition
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[400px] p-4 bg-card border-border shadow-xl rounded-xl"
      >
        <div className="space-y-4">
          {/* Header */}
          <div>
            <h3 className="text-sm font-semibold text-foreground">New Composition</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Describe the video you want to create
            </p>
          </div>

          {/* Prompt textarea */}
          <div className="space-y-2">
            <Textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the video you want to create..."
              className="min-h-[120px] max-h-[200px] text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Press Enter to submit or Shift+Enter for new line
            </p>
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <div
                  key={index}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 border border-border/50 text-xs"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground" />
                  <span className="text-foreground/80 max-w-[150px] truncate">
                    {attachment.name}
                  </span>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="p-0.5 hover:bg-destructive/10 rounded transition-colors"
                  >
                    <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {/* File attachment button */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.svg"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 text-xs"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Attach
              </Button>
            </div>

            {/* Submit button */}
            <Button
              size="sm"
              onClick={submitChat}
              disabled={!prompt.trim()}
              className="h-8 text-xs"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
