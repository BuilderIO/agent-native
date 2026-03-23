import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImageGenModel } from "@shared/api";

const models: { value: ImageGenModel; label: string }[] = [
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "flux", label: "Flux Kontext" },
];

interface ModelDropdownProps {
  selectedModels: ImageGenModel[];
  onToggleModel: (model: ImageGenModel) => void;
}

export function ModelDropdown({
  selectedModels,
  onToggleModel,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const label =
    selectedModels.length === 1
      ? (models.find((m) => m.value === selectedModels[0])?.label ?? "Model")
      : `${selectedModels.length} models`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-border hover:bg-muted transition-colors"
      >
        {label}
        <ChevronDown size={10} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[140px] rounded-md border border-border bg-background shadow-lg z-50 p-1">
          {models.map((m) => {
            const isSelected = selectedModels.includes(m.value);
            return (
              <button
                key={m.value}
                onClick={() => onToggleModel(m.value)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-[11px] rounded-md hover:bg-muted transition-colors text-left"
              >
                <div
                  className={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                    isSelected
                      ? "bg-foreground border-foreground"
                      : "border-border",
                  )}
                >
                  {isSelected && <Check size={9} className="text-background" />}
                </div>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
