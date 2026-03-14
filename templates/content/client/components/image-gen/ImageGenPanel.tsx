import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentChatGenerating } from "@agent-native/core";

interface ImageGenPanelProps {
  projectSlug?: string;
  projectName?: string;
}

export function ImageGenPanel({ projectSlug }: ImageGenPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, sendToAgentChat] = useAgentChatGenerating();

  const handleGenerate = () => {
    if (!prompt.trim() || isGenerating) return;

    sendToAgentChat({
      message: `Generate an image: ${prompt.trim()}`,
      context: projectSlug ? `Project: ${projectSlug}` : undefined,
      submit: true,
    });
    setPrompt("");
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              className="flex w-full rounded-md border border-input bg-muted px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[100px] resize-y"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                  handleGenerate();
                }
              }}
            />

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Cmd+Enter to generate</span>
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className={cn(
                  "inline-flex items-center gap-1.5 justify-center rounded-md text-sm font-medium h-9 px-4 transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:opacity-50 disabled:pointer-events-none"
                )}
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
