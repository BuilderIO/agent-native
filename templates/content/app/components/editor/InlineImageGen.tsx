import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentChatGenerating } from "@agent-native/core";

interface InlineImageGenProps {
  selectedText: string;
  projectSlug: string;
  onClose: () => void;
}

export function InlineImageGen({
  selectedText,
  projectSlug,
  onClose,
}: InlineImageGenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, sendToAgentChat] = useAgentChatGenerating();

  useEffect(() => {
    containerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, []);

  // Auto-close when generation finishes (isGenerating goes from true → false)
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) {
      onClose();
    }
    wasGenerating.current = isGenerating;
  }, [isGenerating, onClose]);

  const handleGenerate = () => {
    if (isGenerating) return;
    sendToAgentChat({
      message: `Generate an inline image for this blog post section.${prompt.trim() ? ` ${prompt.trim()}` : ""}`,
      context: [
        `Project: ${projectSlug}`,
        `IMPORTANT: Run generate-image exactly ONCE with these flags:`,
        `  --model gemini --preset "Daigrams" --project-slug "${projectSlug}"`,
        `The preset passes reference images and style-matching instructions to Gemini automatically.`,
        `Your --prompt should describe a visual concept that represents the selected text.`,
        `Do NOT describe style/colors in the prompt — the preset handles that.`,
        `Focus the prompt on the SUBJECT: what diagram or visual explains this content?`,
        `Insert the chosen image into the draft after the selected text.`,
        ``,
        `Selected text:`,
        selectedText,
      ].join("\n"),
      submit: true,
    });
  };

  return (
    <div
      ref={containerRef}
      className="my-4 border border-border rounded-lg bg-background"
    >
      <div className="flex justify-end px-3 pt-2">
        <button
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            selectedText?.trim()
              ? "Additional instructions... (optional)"
              : "Describe the image you want..."
          }
          className="flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
        />

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Cmd+Enter to generate
          </span>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={cn(
              "inline-flex items-center gap-1.5 justify-center rounded-md text-[11px] font-medium h-7 px-3 transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Send size={12} />
                Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
