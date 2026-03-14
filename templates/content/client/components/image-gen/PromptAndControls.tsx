import { Loader2, ChevronDown, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImageGenModel, ImageGenStatusResponse } from "@shared/api";

const sizeOptions = [
  { value: "1024x1024", label: "Square (1024x1024)" },
  { value: "1536x1024", label: "Landscape (1536x1024)" },
  { value: "1024x1536", label: "Portrait (1024x1536)" },
] as const;

const models: { value: ImageGenModel; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "flux", label: "Flux Kontext" },
];

interface PromptAndControlsProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  selectedModels: ImageGenModel[];
  onToggleModel: (model: ImageGenModel) => void;
  size: string;
  onSizeChange: (size: string) => void;
  status: ImageGenStatusResponse | undefined;
  isPending: boolean;
  pendingModels: ImageGenModel[];
  onGenerate: () => void;
  onCancel: () => void;
}

export function PromptAndControls({
  prompt,
  onPromptChange,
  selectedModels,
  onToggleModel,
  size,
  onSizeChange,
  status,
  isPending,
  pendingModels,
  onGenerate,
  onCancel,
}: PromptAndControlsProps) {
  const hasAvailableModel = selectedModels.some((m) => status?.[m]);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe the image you want to generate..."
          className="flex w-full rounded-md border border-input bg-muted px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[80px] resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              onGenerate();
            }
          }}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Model multi-select */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Models:</span>
          <div className="flex rounded-md border border-border overflow-hidden bg-muted">
            {models.map((m, i) => {
              const isSelected = selectedModels.includes(m.value);
              const isPendingModel = pendingModels.includes(m.value);
              return (
                <button
                  key={m.value}
                  onClick={() => onToggleModel(m.value)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium transition-colors flex items-center gap-1",
                    i > 0 && "border-l border-border",
                    isSelected
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {isPendingModel ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : isSelected ? (
                    <Check size={10} />
                  ) : null}
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Size selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Size:</span>
          <div className="relative">
            <select
              value={size}
              onChange={(e) => onSizeChange(e.target.value)}
              className="appearance-none rounded-md border border-border bg-muted pl-2.5 pr-6 py-1 text-[11px] font-medium cursor-pointer"
            >
              {sizeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={10}
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
            />
          </div>
        </div>

        {/* Generate / Cancel */}
        <div className="flex items-center gap-1 ml-auto">
          {isPending && (
            <button
              onClick={onCancel}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cancel generation"
            >
              <X size={14} />
            </button>
          )}
          <Button
            onClick={isPending ? undefined : onGenerate}
            disabled={isPending || !prompt.trim() || !hasAvailableModel}
            size="sm"
            className="h-7 text-xs gap-1.5"
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              selectedModels.length > 1 ? `Generate (${selectedModels.length})` : "Generate"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
